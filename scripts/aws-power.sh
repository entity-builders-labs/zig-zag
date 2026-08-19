#!/usr/bin/env bash
set -euo pipefail

# AWS CLI v2 opens long/table output in an interactive pager when stdout is a
# terminal. Power commands must always print their result and return to make.
export AWS_PAGER=""

region="${AWS_REGION:-us-east-1}"
project="${AWS_PROJECT_TAG:-zig-zag}"
rds_id="${AWS_RDS_ID:-zig-zag-postgres}"
action="${1:-status}"

active_backend_slot() {
  aws ssm get-parameter --region "$region" --name "/$project/prod/infra/backend_active_slot" \
    --query 'Parameter.Value' --output text 2>/dev/null || echo blue
}

backend_asg_desired_capacity() {
  aws autoscaling update-auto-scaling-group --region "$region" \
    --auto-scaling-group-name "$project-backend-$1" \
    --min-size 0 --max-size 1 --desired-capacity "$2" >/dev/null
}

backend_asg_exists() {
  local count
  count=$(aws autoscaling describe-auto-scaling-groups --region "$region" \
    --auto-scaling-group-names "$project-backend-$1" \
    --query 'length(AutoScalingGroups)' --output text) || return 2
  [ "$count" = "1" ]
}

require_backend_asg() {
  local slot="$1" status
  if backend_asg_exists "$slot"; then
    return
  else
    status=$?
  fi

  if [ "$status" -ne 1 ]; then
    return "$status"
  fi
  echo "No existe el Auto Scaling Group $project-backend-$slot. Aplicá Terraform antes de iniciar el entorno." >&2
  return 1
}

start_backend() {
  local slot="$1"
  echo "Iniciando backend (slot activo: $slot)..."
  backend_asg_desired_capacity "$slot" 1
}

stop_backend() {
  local slot status
  echo 'Deteniendo ambos slots del backend (blue y green)...'
  for slot in blue green; do
    if backend_asg_exists "$slot"; then
      backend_asg_desired_capacity "$slot" 0
    else
      status=$?
      if [ "$status" -ne 1 ]; then
        return "$status"
      fi
      echo "El Auto Scaling Group $project-backend-$slot no existe; ya se considera detenido."
    fi
  done
}

rds_state() {
  aws rds describe-db-instances --region "$region" \
    --filters "Name=db-instance-id,Values=$rds_id" \
    --query 'DBInstances[0].DBInstanceStatus' --output text
}

start_rds() {
  local state
  state=$(rds_state)
  if [ "$state" = "None" ]; then
    echo "No existe la instancia RDS $rds_id. Aplicá Terraform antes de iniciar el entorno." >&2
    exit 1
  fi
  if [ "$state" = "stopping" ]; then
    echo 'Esperando que RDS termine de apagarse...'
    aws rds wait db-instance-stopped --region "$region" --db-instance-identifier "$rds_id"
    state=stopped
  fi
  if [ "$state" = "stopped" ]; then
    echo "Iniciando RDS $rds_id..."
    aws rds start-db-instance --region "$region" --db-instance-identifier "$rds_id" >/dev/null
  elif [ "$state" != "available" ] && [ "$state" != "starting" ]; then
    echo "RDS está en estado $state y no puede iniciarse todavía." >&2
    exit 1
  fi
  aws rds wait db-instance-available --region "$region" --db-instance-identifier "$rds_id"
}

stop_rds() {
  local state
  state=$(rds_state)
  if [ "$state" = "None" ]; then
    echo "La instancia RDS $rds_id no existe; ya se considera detenida."
    return
  fi
  if [ "$state" = "starting" ]; then
    echo 'Esperando que RDS termine de iniciar para poder detenerlo...'
    aws rds wait db-instance-available --region "$region" --db-instance-identifier "$rds_id"
    state=available
  fi
  if [ "$state" = "available" ]; then
    echo "Deteniendo RDS $rds_id..."
    aws rds stop-db-instance --region "$region" --db-instance-identifier "$rds_id" >/dev/null
  elif [ "$state" != "stopped" ] && [ "$state" != "stopping" ]; then
    echo "RDS está en estado $state y no puede detenerse todavía." >&2
    exit 1
  else
    echo "RDS ya está $state."
  fi
}

case "$action" in
  start)
    backend_slot=$(active_backend_slot)
    # Validate the backend before starting RDS so a missing ASG cannot leave
    # the database running after a partially failed start.
    require_backend_asg "$backend_slot"
    start_rds
    start_backend "$backend_slot"
    echo 'Infra encendida. El ALB puede tardar unos minutos en marcar el backend como healthy.'
    ;;
  stop)
    stop_backend
    stop_rds
    ;;
  status)
    # JMESPath uses backticks; single quotes intentionally prevent shell expansion.
    # shellcheck disable=SC2016
    aws ec2 describe-instances --region "$region" \
      --filters "Name=tag:Project,Values=$project" \
      --query 'Reservations[].Instances[].[Tags[?Key==`Name`]|[0].Value,InstanceType,State.Name]' --output table
    aws autoscaling describe-auto-scaling-groups --region "$region" \
      --auto-scaling-group-names "$project-backend-blue" "$project-backend-green" \
      --query 'AutoScalingGroups[].[AutoScalingGroupName,DesiredCapacity,length(Instances)]' --output table
    # shellcheck disable=SC2016
    aws ssm get-parameter --region "$region" --name "/$project/prod/infra/backend_active_slot" \
      --query '`Active backend slot: ` + Parameter.Value' --output text 2>/dev/null || true
    if [ "$(rds_state)" = "None" ]; then
      echo "RDS $rds_id: no existe"
    else
      aws rds describe-db-instances --region "$region" --db-instance-identifier "$rds_id" \
        --query 'DBInstances[0].[DBInstanceIdentifier,DBInstanceClass,DBInstanceStatus]' --output table
    fi
    ;;
  *)
    echo 'Uso: scripts/aws-power.sh start|stop|status' >&2
    exit 2
    ;;
esac
