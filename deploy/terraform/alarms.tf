# Lambda calls per hour, emailed past the line: a loop that spins (10-30: up to 840k an hour) is
# seen in an hour, not at AWS's 85%-of-free-tier email. Normal is 850-1,900 an hour.
# Free: SNS email and the first 10 alarms.

resource "aws_sns_topic" "alarms" {
  count = var.alarm_email == "" ? 0 : 1
  name  = "${local.prefix}-alarms"
}

# AWS sends a confirm link first; nothing arrives until it is clicked.
resource "aws_sns_topic_subscription" "alarms_email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "worker_calls" {
  count               = var.alarm_email == "" ? 0 : 1
  alarm_name          = "${local.prefix}-worker-calls-per-hour"
  alarm_description   = "wren worker Lambda over ${var.alarm_calls_per_hour} calls in an hour: a loop may spin. `wren loops`, then Restate's invocations."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  dimensions          = { FunctionName = aws_lambda_function.worker.function_name }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = var.alarm_calls_per_hour
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]
  ok_actions          = [aws_sns_topic.alarms[0].arn]
}
