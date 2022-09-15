import {getInput, getInputBoolean} from "./utils/inputs";
import {getAwsCredentials, getRequestId} from "./utils/environment";
import {DescribeTasksCommand, ECSClient, LaunchType, RunTaskCommand} from "@aws-sdk/client-ecs";
import * as core from '@actions/core'

type TaskArn = string;

async function startTask(
    ecsClient: ECSClient,
    cluster: string,
    taskDefinition: string,
    subnets: string[],
    securityGroups: string[],
    command: string[]
) : Promise<TaskArn> {

  const runTaskCommand = new RunTaskCommand({
    cluster: cluster,
    taskDefinition: taskDefinition,
    count: 1,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: subnets,
        securityGroups: securityGroups
      }
    },
    launchType: LaunchType.FARGATE,
    overrides: {
      containerOverrides: [{
        command: command,
      }]
    }
  })
  const runTaskResult = await ecsClient.send(runTaskCommand);
  if (runTaskResult.failures) {
    console.log("Failed to start task: ", runTaskResult.failures)
    throw new Error(runTaskResult.failures[0].reason)
  } else if (runTaskResult.tasks === undefined || runTaskResult.tasks.length === 0) {
    console.log ("No tasks started");
    throw new Error("No tasks started");
  } else {
    if (runTaskResult.tasks[0].taskArn) {
      return runTaskResult.tasks[0].taskArn as TaskArn;
    } else {
      console.log("Task does not have ARN")
      throw new Error("Task does not have ARN");
    }
  }
}

type HasFinishedResult = {
  hasFinished: boolean,
  exitCode: number
};

async function hasTaskFinished(ecsClient: ECSClient, cluster: string, container: string, taskArn: string) : Promise<HasFinishedResult> {
  const describeTaskCommand = new DescribeTasksCommand({
    cluster: cluster,
    tasks: [taskArn]
  });
  console.log(`Checking status on task ${taskArn}`);
  const describeTaskResult = await ecsClient.send(describeTaskCommand);
  if (describeTaskResult.failures) {
    console.log("Describe Task had failures");
    console.log (describeTaskResult.failures);
    return {
      hasFinished: true,
      exitCode: -1
    };
  } else if (describeTaskResult.tasks === undefined || describeTaskResult.tasks.length === 0) {
    console.log("Describe Task had no tasks in response");
    return {
      hasFinished: true,
      exitCode: -1
    };
  } else {
    const taskOfInterest = describeTaskResult.tasks[0];
    if ( taskOfInterest.lastStatus !== "STOPPED"){
      console.log(`Task ${taskArn} is still running. Last Status is ${taskOfInterest.lastStatus}`);
      return {
        hasFinished: false,
        exitCode: -1
      };
    } else {
      console.log(`Task ${taskArn} has stopped running. Last Status is ${taskOfInterest.lastStatus}`);
    }

    const containersOfInterest = taskOfInterest.containers?.filter( c => c.name === container );
    if (containersOfInterest && containersOfInterest.length >= 0) {
      const containerStatus = containersOfInterest[0];
      const exitCode = containerStatus.exitCode;
      console.log(`Task ${taskArn} exit code of ${container} is ${exitCode}`);
      return {
        hasFinished: true,
        exitCode: exitCode || 0
      };
    } else {
      return {
        hasFinished: true,
        exitCode: -1
      };
    }
  }
}

type RunResult = {
  success: boolean,
  exitCode: number
}

export async function run(
  ecsClient: ECSClient,
  ecsCluster: string,
  ecsTaskDefinition: string,
  subnets: string[],
  securityGroups: string[],
  container: string,
  command: string[],
  checkIntervalMs: number = 5000
): Promise<RunResult> {

  const taskArn = await startTask(ecsClient, ecsCluster, ecsTaskDefinition, subnets, securityGroups, command);

  return new Promise<RunResult>( (resolve, reject) => {

    const intervalId = setInterval( async () => {
      try {
        const result = await hasTaskFinished(ecsClient, ecsCluster, container, taskArn);
        if (result.hasFinished) {
          console.log(`Task Exited with result ${result.exitCode}`);
          clearInterval(intervalId);
          resolve({
            success: result.exitCode === 0,
            exitCode: result.exitCode
          });
        }
      } catch(e){
        clearInterval(intervalId);
        reject(e);
      }
    }, checkIntervalMs);
  })

}

/* istanbul ignore next */
if (require.main === module) {
  const awsCredentials = getAwsCredentials();
  console.log(`AWS Credentials.accessKeyId = ${awsCredentials.accessKeyId.substring(1,3)}*******`);
  console.log(`AWS Region = ${awsCredentials.region}`);

  const ecsCluster = getInput("ecs_cluster");
  const ecsTaskDefinition = getInput("ecs_task_definition");
  const securityGroupIds = getInput("security_group_ids").trim().split(",");
  const subnets = getInput("subnets").trim().split(",");
  const container = getInput("container");
  const command = getInput("command").trim().split(",");

  console.log(`ecsCluster = ${ecsCluster}`);
  console.log(`ecsTaskDefinition = ${ecsTaskDefinition}`);
  console.log(`securityGroupIds = ${securityGroupIds}`);
  console.log(`subnets = ${subnets}`);
  console.log(`container = ${container}`);
  console.log(`command = ${command}`);

  const ecsClient = new ECSClient({
    credentials: {
      accessKeyId: awsCredentials.accessKeyId,
      secretAccessKey: awsCredentials.secretAccessKey,
    },
    region: awsCredentials.region,
  });
  run(
      ecsClient,
      ecsCluster,
      ecsTaskDefinition,
      securityGroupIds,
      subnets,
      container,
      command
  ).then((result) => {
      core.setOutput('success', result.success);
      core.setOutput('exit_code', result.exitCode);
    })
    .catch((e) => {
      core.setFailed(e);
      core.setOutput('success', false);
      throw e;
    });
}
