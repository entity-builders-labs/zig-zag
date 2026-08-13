#!/usr/bin/env bash
# Blue/green canary rollout controller for the backend ASGs.
#
# Terraform keeps two fixed ASG/target-group slots (blue, green) with a
# weighted forward rule on the ALB listener between them, plus 3 CloudWatch
# alarms (5xx rate, p95 latency, CPU) per slot. This script is the only thing
# that moves state between deploys: which slot is "active" (SSM parameter
# backend_active_slot) and how the listener weight is split.
#
# Deliberately not using repeated `terraform apply` calls mid-rollout — a
# `-target` apply had unexpected side effects once already in this project
# (see plan file). Terraform only owns the steady-state shape; this script
# only ever calls the AWS API directly for anything that changes per deploy.
#
# Usage:
#   canary-deploy.sh deploy <image-tag>   Full staged rollout to the inactive slot
#   canary-deploy.sh promote              Jump whatever's mid-canary straight to 100%
#   canary-deploy.sh rollback             Flip back to the slot NOT marked active
set -euo pipefail

region="${AWS_REGION:-us-east-1}"
project="${AWS_PROJECT_TAG:-zig-zag}"
active_slot_param="/${project}/prod/infra/backend_active_slot"
image_tag_param="/${project}/prod/infra/backend_image_tag"
listener_rule_arn="${BACKEND_LISTENER_RULE_ARN:?BACKEND_LISTENER_RULE_ARN is required}"

# Space-separated canary stages (percent of traffic on the new slot) and how
# long to bake (watching alarms) at each one before moving to the next.
# Override for a faster dry run, e.g. CANARY_STAGE_WEIGHTS="50" CANARY_BAKE_SECONDS=30.
stage_weights=(${CANARY_STAGE_WEIGHTS:-10 50 100})
bake_seconds="${CANARY_BAKE_SECONDS:-120}"
health_timeout_seconds="${CANARY_HEALTH_TIMEOUT_SECONDS:-300}"

other_slot() { [ "$1" = "blue" ] && echo green || echo blue; }

asg_name() { echo "${project}-backend-$1"; }

target_group_arn() {
  aws elbv2 describe-target-groups --region "$region" --names "${project}-backend-$1" \
    --query 'TargetGroups[0].TargetGroupArn' --output text
}

active_slot() {
  aws ssm get-parameter --region "$region" --name "$active_slot_param" \
    --query 'Parameter.Value' --output text
}

set_active_slot() {
  aws ssm put-parameter --region "$region" --name "$active_slot_param" \
    --value "$1" --type String --overwrite >/dev/null
}

scale_asg() {
  local slot="$1" desired="$2"
  echo "Scaling ${slot} ASG to desired_capacity=${desired}..."
  aws autoscaling update-auto-scaling-group --region "$region" \
    --auto-scaling-group-name "$(asg_name "$slot")" \
    --min-size 0 --max-size 1 --desired-capacity "$desired" >/dev/null
}

wait_for_healthy_target() {
  local slot="$1" tg_arn elapsed=0
  tg_arn=$(target_group_arn "$slot")
  echo "Waiting for a healthy target in ${slot} (timeout ${health_timeout_seconds}s)..."
  while [ "$elapsed" -lt "$health_timeout_seconds" ]; do
    status=$(aws elbv2 describe-target-health --region "$region" --target-group-arn "$tg_arn" \
      --query 'TargetHealthDescriptions[0].TargetHealth.State' --output text 2>/dev/null || echo "")
    if [ "$status" = "healthy" ]; then
      echo "${slot} target is healthy."
      return 0
    fi
    sleep 10
    elapsed=$((elapsed + 10))
  done
  echo "ERROR: ${slot} did not become healthy within ${health_timeout_seconds}s" >&2
  return 1
}

set_weights() {
  local blue_weight="$1" green_weight="$2"
  echo "Setting listener weights: blue=${blue_weight} green=${green_weight}"
  aws elbv2 modify-rule --region "$region" --rule-arn "$listener_rule_arn" \
    --actions "Type=forward,ForwardConfig={TargetGroups=[{TargetGroupArn=$(target_group_arn blue),Weight=${blue_weight}},{TargetGroupArn=$(target_group_arn green),Weight=${green_weight}}]}" \
    >/dev/null
}

current_weights() {
  aws elbv2 describe-rules --region "$region" --rule-arns "$listener_rule_arn" \
    --query 'Rules[0].Actions[0].ForwardConfig.TargetGroups[].[TargetGroupArn,Weight]' --output text
}

# Any of the 3 alarms for $1 (blue|green) currently ALARM? Prints "1" if so.
slot_has_alarm() {
  local slot="$1"
  aws cloudwatch describe-alarms --region "$region" \
    --alarm-names "${project}-backend-${slot}-5xx" "${project}-backend-${slot}-latency" "${project}-backend-${slot}-cpu" \
    --state-value ALARM --query 'length(MetricAlarms)' --output text
}

cmd_deploy() {
  local image_tag="${1:?Usage: canary-deploy.sh deploy <image-tag>}"
  local active inactive weight

  active=$(active_slot)
  inactive=$(other_slot "$active")
  echo "Active slot: ${active}. Deploying image ${image_tag} to ${inactive}."

  aws ssm put-parameter --region "$region" --name "$image_tag_param" \
    --value "$image_tag" --type String --overwrite >/dev/null

  # Cycle the inactive slot even if it was left warm from a previous deploy —
  # it's running old code either way, and user_data only deploys once, at
  # boot, so a fresh instance is the only way to pick up the new tag.
  scale_asg "$inactive" 0
  aws autoscaling describe-auto-scaling-groups --region "$region" \
    --auto-scaling-group-names "$(asg_name "$inactive")" \
    --query 'AutoScalingGroups[0].Instances[].InstanceId' --output text \
    | tr '\t' '\n' | grep -q . && {
      echo "Waiting for ${inactive}'s previous instance to terminate..."
      while [ "$(aws autoscaling describe-auto-scaling-groups --region "$region" \
        --auto-scaling-group-names "$(asg_name "$inactive")" \
        --query 'length(AutoScalingGroups[0].Instances)' --output text)" != "0" ]; do
        sleep 5
      done
    }
  scale_asg "$inactive" 1

  wait_for_healthy_target "$inactive"

  for weight in "${stage_weights[@]}"; do
    if [ "$active" = "blue" ]; then set_weights "$((100 - weight))" "$weight"
    else set_weights "$weight" "$((100 - weight))"; fi

    echo "Baking at ${weight}% on ${inactive} for ${bake_seconds}s..."
    sleep "$bake_seconds"

    if [ "$(slot_has_alarm "$inactive")" != "0" ]; then
      echo "ERROR: alarm fired on ${inactive} at ${weight}% — rolling back." >&2
      if [ "$active" = "blue" ]; then set_weights 100 0; else set_weights 0 100; fi
      scale_asg "$inactive" 0
      exit 1
    fi
  done

  set_active_slot "$inactive"
  echo "Deploy complete. Active slot is now ${inactive}. ${active} stays warm on standby for a fast rollback."
}

cmd_promote() {
  local active canary
  active=$(active_slot)
  canary=$(other_slot "$active")
  echo "Promoting ${canary} to 100% immediately (skipping remaining canary stages)."
  wait_for_healthy_target "$canary"
  if [ "$canary" = "blue" ]; then set_weights 100 0; else set_weights 0 100; fi
  set_active_slot "$canary"
  echo "Promoted. Active slot is now ${canary}."
}

cmd_rollback() {
  local active target
  active=$(active_slot)
  target=$(other_slot "$active")
  echo "Rolling back: ${active} -> ${target}."

  if [ "$(aws autoscaling describe-auto-scaling-groups --region "$region" \
    --auto-scaling-group-names "$(asg_name "$target")" \
    --query 'AutoScalingGroups[0].DesiredCapacity' --output text)" = "0" ]; then
    echo "${target} is scaled down — starting it back up first (this will take a few minutes)."
    scale_asg "$target" 1
  fi
  wait_for_healthy_target "$target"

  if [ "$target" = "blue" ]; then set_weights 100 0; else set_weights 0 100; fi
  set_active_slot "$target"
  echo "Rolled back. Active slot is now ${target}."
}

case "${1:-}" in
  deploy) cmd_deploy "${2:-}" ;;
  promote) cmd_promote ;;
  rollback) cmd_rollback ;;
  *)
    echo "Usage: $0 {deploy <image-tag>|promote|rollback}" >&2
    exit 2
    ;;
esac
