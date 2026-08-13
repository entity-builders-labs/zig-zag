#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-us-east-1}"
project="${AWS_PROJECT_TAG:-zig-zag}"
rds_id="${AWS_RDS_ID:-zig-zag-postgres}"
action="${1:-status}"

instance_ids() {
  local role="$1"
  aws ec2 describe-instances --region "$region" \
    --filters "Name=tag:Project,Values=$project" "Name=tag:Role,Values=$role" \
      "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[].InstanceId' --output text
}

start_instances() {
  local role="$1" ids id state
  local -a id_list
  ids=$(instance_ids "$role")
  if [ -z "$ids" ]; then
    echo "No se encontraron instancias para $role."
    return
  fi

  read -r -a id_list <<<"$ids"
  for id in "${id_list[@]}"; do
    state=$(aws ec2 describe-instances --region "$region" --instance-ids "$id" \
      --query 'Reservations[0].Instances[0].State.Name' --output text)
    if [ "$state" = "stopping" ]; then
      echo "Esperando que $role $id termine de apagarse..."
      aws ec2 wait instance-stopped --region "$region" --instance-ids "$id"
      state=stopped
    fi
    if [ "$state" = "stopped" ]; then
      echo "Iniciando $role: $id"
      aws ec2 start-instances --region "$region" --instance-ids "$id" >/dev/null
    fi
  done
  aws ec2 wait instance-running --region "$region" --instance-ids "${id_list[@]}"
}

stop_instances() {
  local role="$1" ids running
  local -a id_list running_list
  # Only chroma goes through here now — backend is ASG-managed (see
  # stop_backend) and must never be stopped by a direct ec2 stop-instances
  # call, or its ASG health check would see it as unhealthy and try to
  # replace it instead of leaving it stopped.
  ids=$(aws ec2 describe-instances --region "$region" \
    --filters "Name=tag:Project,Values=$project" "Name=tag:Role,Values=$role" \
      "Name=instance-state-name,Values=pending,running,stopping" \
    --query 'Reservations[].Instances[].InstanceId' --output text)
  [ -z "$ids" ] && { echo "No hay instancias de $role encendidas."; return; }

  read -r -a id_list <<<"$ids"
  running=$(aws ec2 describe-instances --region "$region" --instance-ids "${id_list[@]}" \
    --filters "Name=instance-state-name,Values=pending,running" \
    --query 'Reservations[].Instances[].InstanceId' --output text)
  if [ -n "$running" ]; then
    read -r -a running_list <<<"$running"
    echo "Deteniendo EC2: $running"
    aws ec2 stop-instances --region "$region" --instance-ids "${running_list[@]}" >/dev/null
  fi
  aws ec2 wait instance-stopped --region "$region" --instance-ids "${id_list[@]}"
}

active_backend_slot() {
  aws ssm get-parameter --region "$region" --name "/$project/prod/infra/backend_active_slot" \
    --query 'Parameter.Value' --output text 2>/dev/null || echo blue
}

backend_asg_desired_capacity() {
  aws autoscaling update-auto-scaling-group --region "$region" \
    --auto-scaling-group-name "$project-backend-$1" \
    --min-size 0 --max-size 1 --desired-capacity "$2" >/dev/null
}

start_backend() {
  local slot
  slot=$(active_backend_slot)
  echo "Iniciando backend (slot activo: $slot)..."
  backend_asg_desired_capacity "$slot" 1
}

stop_backend() {
  echo 'Deteniendo ambos slots del backend (blue y green)...'
  backend_asg_desired_capacity blue 0
  backend_asg_desired_capacity green 0
}

rds_state() {
  aws rds describe-db-instances --region "$region" --db-instance-identifier "$rds_id" \
    --query 'DBInstances[0].DBInstanceStatus' --output text
}

start_rds() {
  local state
  state=$(rds_state)
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
    start_rds
    start_instances chroma
    start_backend
    echo 'Infra encendida. El ALB puede tardar unos minutos en marcar el backend como healthy.'
    ;;
  stop)
    stop_backend
    stop_instances chroma
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
    aws ssm get-parameter --region "$region" --name "/$project/prod/infra/backend_active_slot" \
      --query '`Active backend slot: ` + Parameter.Value' --output text 2>/dev/null || true
    aws rds describe-db-instances --region "$region" --db-instance-identifier "$rds_id" \
      --query 'DBInstances[0].[DBInstanceIdentifier,DBInstanceClass,DBInstanceStatus]' --output table
    ;;
  *)
    echo 'Uso: scripts/aws-power.sh start|stop|status' >&2
    exit 2
    ;;
esac
