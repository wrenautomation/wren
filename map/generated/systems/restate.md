# Restate Cloud: system

Durable execution: journals every service call and invokes the worker.

## Links

- restate invokes wren.lambda:worker: 60 services
  - in `apps/worker/src/lambda.ts`
- restate invokes wren.container:worker: 60 services
  - in `apps/worker/src/box.ts`
