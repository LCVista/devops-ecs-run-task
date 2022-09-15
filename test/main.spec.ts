import { run } from "../src/main";
import {
  DescribeTasksCommand,
  DescribeTasksCommandOutput,
  ECSClient, ListTaskDefinitionsCommand, ListTaskDefinitionsCommandOutput,
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

function mockECSClient(container: string, exitCode: number) {
  let statusChecks = 0;
  return (command: any): Promise<RunTaskCommandOutput | DescribeTasksCommandOutput | ListTaskDefinitionsCommandOutput> => {
    if (command instanceof ListTaskDefinitionsCommand) {
      return Promise.resolve({
        taskDefinitionArns:["arn://unit-test-task-definition"]
      } as ListTaskDefinitionsCommandOutput);
    } else if (command instanceof RunTaskCommand) {
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
            }]
          }
        ]
      } as DescribeTasksCommandOutput);
    } else {
      return Promise.reject("Not implemented");
    }
  };
}

test("Happy path: Start task and see it finish with success", async () => {
  // Arrange
  const cluster = "unit-test-cluster";
  const taskDefinition = "unit-test-task-definition";
  const container = "unit-test-container";
  const command = ["bash", "echo"]
  let client = {} as ECSClient;
  client["send"] = jest
      .fn()
      .mockImplementation( mockECSClient (container, 0) );
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
  expect(spySend.mock.calls.length).toBe(8);
  expect(result.success).toBe(true);
  expect(result.exitCode).toBe(0);
  expect(result.taskArn).toBe("arn://unit-test");
});

test("Happy path: Start task and see it finish with failure", async () => {
  // Arrange
  const cluster = "unit-test-cluster";
  const taskDefinition = "unit-test-task-definition";
  const container = "unit-test-container";
  const command = ["bash", "echo"];
  const exitCode = 127;
  let client = {} as ECSClient;
  client["send"] = jest
      .fn()
      .mockImplementation( mockECSClient (container, exitCode) );
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
  expect(result.success).toBe(false);
  expect(result.exitCode).toBe(exitCode);
  expect(result.taskArn).toBe("arn://unit-test");
});
