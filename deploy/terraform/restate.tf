# The role Restate Cloud assumes to invoke the worker — and nothing else. Its
# trust policy comes verbatim from the Cloud UI (it names their principal and
# this environment's external id).

resource "aws_iam_role" "restate_invoker" {
  count              = var.restate_trust_policy == "" ? 0 : 1
  name               = "${local.prefix}-restate-invoker"
  assume_role_policy = var.restate_trust_policy
}

data "aws_iam_policy_document" "restate_invoker" {
  statement {
    actions = ["lambda:InvokeFunction"]
    resources = [
      aws_lambda_function.worker.arn,
      "${aws_lambda_function.worker.arn}:*",
    ]
  }
}

resource "aws_iam_role_policy" "restate_invoker" {
  count  = var.restate_trust_policy == "" ? 0 : 1
  name   = "invoke-worker"
  role   = aws_iam_role.restate_invoker[0].id
  policy = data.aws_iam_policy_document.restate_invoker.json
}
