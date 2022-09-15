import { run } from "../src/main";
import {
  DescribeTasksCommand,
  DescribeTasksCommandOutput,
  ECSClient,
  RunTaskCommand,
  RunTaskCommandOutput
} from "@aws-sdk/client-ecs";

beforeEach(() => {
  jest.resetAllMocks();
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.resetAllMocks();
  jest.restoreAllMocks();
});

test("Happy path: Start task and see it finish with success", async () => {
  // Arrange
  const cluster = "unit-test-cluster";
  const taskDefinition = "unit-test-task-definition";
  const container = "unit-test-container";
  const command = ["bash", "echo"]
  let client = {} as ECSClient;
  let statusChecks = 0;
  client["send"] = jest
      .fn()
      .mockImplementation(
          (command: any): Promise<RunTaskCommandOutput | DescribeTasksCommandOutput> => {
            if (command instanceof RunTaskCommand) {
              let coerced = command as RunTaskCommand;
              return Promise.resolve({
                $metadata: {},
                failures: undefined,
                tasks: [
                  {
                    taskArn: "arn://unit-test",
                    lastStatus: "PENDING",
                    containers: [{
                      name: container
                    }]
                  }
                ]
              } as RunTaskCommandOutput);
            } else if (command instanceof DescribeTasksCommand) {
              let coerced = command as DescribeTasksCommand;
              return Promise.resolve({
                $metadata: {},
                failures: undefined,
                tasks: [
                  {
                    taskArn: "arn://unit-test",
                    lastStatus: statusChecks++ > 4 ? "STOPPED" : "RUNNING",
                    containers: [{
                      name: container,
                      exitCode: 0
                    }]
                  }
                ]
              } as DescribeTasksCommandOutput);
            } else {
              return Promise.reject("Not implemented");
            }
          });
  let spySend = jest.spyOn(client, "send");

  // Act
  let result = await run(
      client,
      cluster,
      taskDefinition,
      [],
      [],
      container,
      command,
      5
  )

  // Assert
  expect(spySend.mock.calls.length).toBe(7);
  expect(result.success).toBe(true);
  expect(result.exitCode).toBe(0);
});

test("Happy path: Start task and see it finish with failure", async () => {
  // Arrange
  const cluster = "unit-test-cluster";
  const taskDefinition = "unit-test-task-definition";
  const container = "unit-test-container";
  const command = ["bash", "echo"];
  const exitCode = 127;
  let client = {} as ECSClient;
  let statusChecks = 0;
  client["send"] = jest
      .fn()
      .mockImplementation(
          (command: any): Promise<RunTaskCommandOutput | DescribeTasksCommandOutput> => {
            if (command instanceof RunTaskCommand) {
              let coerced = command as RunTaskCommand;
              return Promise.resolve({
                $metadata: {},
                failures: undefined,
                tasks: [
                  {
                    taskArn: "arn://unit-test",
                    lastStatus: "PENDING",
                    containers: [{
                      name: container
                    }]
                  }
                ]
              } as RunTaskCommandOutput);
            } else if (command instanceof DescribeTasksCommand) {
              let coerced = command as DescribeTasksCommand;
              return Promise.resolve({
                $metadata: {},
                failures: undefined,
                tasks: [
                  {
                    taskArn: "arn://unit-test",
                    lastStatus: statusChecks++ > 4 ? "STOPPED" : "RUNNING",
                    containers: [{
                      name: container,
                      exitCode: exitCode
                    },{
                      name: "sidecar",
                      exitCode: 0
                    }]
                  }
                ]
              } as DescribeTasksCommandOutput);
            } else {
              return Promise.reject("Not implemented");
            }
          });
  let spySend = jest.spyOn(client, "send");

  // Act
  let result = await run(
      client,
      cluster,
      taskDefinition,
      [],
      [],
      container,
      command,
      5
  )

  // Assert
  expect(spySend.mock.calls.length).toBe(7);
  expect(result.success).toBe(false);
  expect(result.exitCode).toBe(exitCode);
});
