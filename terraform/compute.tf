resource "aws_cloudwatch_log_group" "backend" {
  name              = "/${var.project_name}/backend"
  retention_in_days = 14
}

resource "aws_instance" "chroma" {
  ami                         = data.aws_ami.amazon_linux.id
  instance_type               = var.chroma_instance_type
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.chroma.id]
  associate_public_ip_address = true
  # Fixed on purpose: the backend's user_data embeds this instance's private
  # IP directly (see chroma_url below). A dynamically-assigned IP would
  # change on every replacement of this instance, which would then cascade
  # into forcing a replacement of the backend instance too (its user_data
  # would differ). Pinning it breaks that chain.
  private_ip                  = "10.20.0.100"
  iam_instance_profile        = aws_iam_instance_profile.chroma.name
  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/templates/chroma-user-data.sh.tftpl", {
    chroma_image = var.chroma_image
  })

  credit_specification { cpu_credits = "standard" }
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }
  root_block_device {
    volume_type           = "gp3"
    volume_size           = 8
    encrypted             = true
    delete_on_termination = true
  }

  tags = { Name = "${var.project_name}-chroma", Role = "chroma" }

  # associate_public_ip_address can't be read back reliably once an instance
  # has been stopped — AWS reports whether a public IP is *currently*
  # attached (false while stopped, since non-Elastic public IPs are released
  # on stop), not the launch-time intent. Without this, every stop/start
  # cycle makes Terraform think this drifted and wants to replace the
  # instance.
  lifecycle { ignore_changes = [associate_public_ip_address] }
}

resource "aws_ebs_volume" "chroma_data" {
  availability_zone = aws_subnet.public[0].availability_zone
  size              = 8
  type              = "gp3"
  encrypted         = true
  tags              = { Name = "${var.project_name}-chroma-data" }

  lifecycle { prevent_destroy = true }
}

resource "aws_volume_attachment" "chroma_data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.chroma_data.id
  instance_id = aws_instance.chroma.id
}

resource "aws_instance" "backend" {
  ami                         = data.aws_ami.amazon_linux.id
  instance_type               = var.backend_instance_type
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.backend.id]
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.backend.name
  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/templates/backend-user-data.sh.tftpl", {
    aws_region         = var.aws_region
    app_parameter      = var.app_config_parameter_name
    db_secret_arn      = aws_db_instance.main.master_user_secret[0].secret_arn
    db_host            = aws_db_instance.main.address
    db_port            = aws_db_instance.main.port
    db_name            = aws_db_instance.main.db_name
    chroma_url         = "http://${aws_instance.chroma.private_ip}:8000"
    cors_origin        = "https://${aws_cloudfront_distribution.frontend.domain_name}"
    ecr_repository_url = aws_ecr_repository.backend.repository_url
    backend_log_group  = aws_cloudwatch_log_group.backend.name
  })

  credit_specification { cpu_credits = "standard" }
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }
  root_block_device {
    volume_type           = "gp3"
    volume_size           = 8
    encrypted             = true
    delete_on_termination = true
  }

  tags = { Name = "${var.project_name}-backend", Role = "backend" }

  # See the matching comment on aws_instance.chroma — same reason.
  lifecycle { ignore_changes = [associate_public_ip_address] }
}

resource "aws_lb_target_group_attachment" "backend" {
  target_group_arn = aws_lb_target_group.backend.arn
  target_id        = aws_instance.backend.id
  port             = 3000
}

resource "aws_cloudwatch_metric_alarm" "backend_status" {
  alarm_name          = "${var.project_name}-backend-instance-status"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  dimensions          = { InstanceId = aws_instance.backend.id }
}

resource "aws_cloudwatch_metric_alarm" "chroma_status" {
  alarm_name          = "${var.project_name}-chroma-instance-status"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  dimensions          = { InstanceId = aws_instance.chroma.id }
}
