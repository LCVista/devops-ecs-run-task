import {getInput} from "./utils/inputs";
import {getAwsCredentials} from "./utils/environment";
import {
  DescribeTasksCommand,
    StopTaskCommand,
    StopTaskCommandInput,
  ECSClient,
  LaunchType,
  ListTaskDefinitionsCommand,
  RunTaskCommand,
  RunTaskCommandInput,
  SortOrder,
  Tag
} from "@aws-sdk/client-ecs";
import * as core from '@actions/core'
import NodeJS from "node:process";
import process from "node:process";

type TaskArn = string;
type SubnetId = string;
type SecurityGroupId = string;

async function startTask(
    ecsClient: ECSClient,
    cluster: string,
    taskDefinition: string,
    subnets: SubnetId[],
    securityGroups: SecurityGroupId[],
    container: string,
    command: string[],
    tags?: Tag[],
    group?: string,
) : Promise<TaskArn> {

  const listDefinitionsCommand = new ListTaskDefinitionsCommand({
    familyPrefix: taskDefinition,
    sort: SortOrder.DESC,
    maxResults: 1
  })
  const taskDefinitions = await ecsClient.send(listDefinitionsCommand);

  if (taskDefinitions.taskDefinitionArns === undefined || taskDefinitions.taskDefinitionArns.length === 0) {
    throw Error(`Task definition ${taskDefinition} not found`);
  }
  let runTaskInput: RunTaskCommandInput = {
    cluster: cluster,
    taskDefinition: taskDefinitions.taskDefinitionArns[0],
    count: 1,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: subnets,
        securityGroups: securityGroups,
        assignPublicIp: "ENABLED"
      }
    },
    launchType: LaunchType.FARGATE,
    overrides: {
      containerOverrides: [{
        name: container,
        command: command,
      }]
    }
  };
  if (tags && tags.length > 0){
    runTaskInput.tags = tags;
  }
  if (group){
    runTaskInput.group = group;
  }
  const runTaskCommand = new RunTaskCommand(runTaskInput)
  const runTaskResult = await ecsClient.send(runTaskCommand);
  if (runTaskResult.failures && runTaskResult.failures.length > 0) {
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

async function hasTaskFinished(ecsClient: ECSClient, cluster: string, container: string, taskArn: TaskArn) : Promise<HasFinishedResult> {
  const describeTaskCommand = new DescribeTasksCommand({
    cluster: cluster,
    tasks: [taskArn]
  });
  console.log(`Checking status on task ${taskArn}`);
  const describeTaskResult = await ecsClient.send(describeTaskCommand);
  if (describeTaskResult.failures && describeTaskResult.failures.length > 0) {
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
      if (exitCode === undefined){
        return {
          hasFinished: true,
          exitCode: -99
        };
      } else {
        return {
          hasFinished: true,
          exitCode: exitCode
        };
      }
    } else {
      return {
        hasFinished: true,
        exitCode: -1
      };
    }
  }
}

async function stopTask(ecsClient: ECSClient, cluster: string, container: string, taskArn: TaskArn, reason: string = "") : Promise<StopResult> {
  const stopTaskCommand : StopTaskCommand = new StopTaskCommand({
    cluster: cluster,
    task: taskArn,
    reason: reason
  });
  const result = await ecsClient.send(stopTaskCommand);
  return {
    taskArn: result.task?.taskArn || taskArn,
    lastStatus: result.task?.lastStatus || "unknown",
    stoppedAt: result.task?.stoppedAt?.toString() || ""
  }
}

type StopResult = {
  taskArn: string,
  lastStatus: string,
  stoppedAt: string
}

type RunResult = {
  success: boolean,
  exitCode: number,
  taskArn: string,
  wasStopped: boolean
}

export async function run(
  proc: NodeJS.Process | undefined,
  ecsClient: ECSClient,
  ecsCluster: string,
  ecsTaskDefinition: string,
  subnets: SubnetId[],
  securityGroups: SecurityGroupId[],
  container: string,
  command: string[],
  checkIntervalMs: number = 5000,
  tags?: Tag[],
  group?: string
): Promise<RunResult> {

  console.log(`Starting task on cluster ${ecsCluster} for task definition ${ecsTaskDefinition}`);
  const taskArn = await startTask(ecsClient, ecsCluster, ecsTaskDefinition, subnets, securityGroups, container, command, tags, group);

  return new Promise<RunResult>( (resolve, reject) => {

    const intervalId = setInterval( async () => {
      try {
        const result = await hasTaskFinished(ecsClient, ecsCluster, container, taskArn);
        if (result.hasFinished) {
          console.log(`Task Exited with result ${result.exitCode}`);
          clearInterval(intervalId);
          resolve({
            success: result.exitCode === 0,
            exitCode: result.exitCode,
            taskArn: taskArn,
            wasStopped: false
          });
        }
      } catch(e){
        clearInterval(intervalId);
        reject(e);
      }
    }, checkIntervalMs);

    if (proc) {
      proc.on('SIGTERM', async () => {
        console.log(`Received SIGTERM, stopping`);
        clearInterval(intervalId);
        const stopResult = await stopTask(ecsClient, ecsCluster, container, taskArn);
        console.log(stopResult);
        resolve({
          success: false,
          exitCode: 127,
          taskArn: taskArn,
          wasStopped: true
        });
      })

      proc.on('SIGHUP', async () => {
        console.log(`Received SIGHUP, stopping`);
        clearInterval(intervalId);
        const stopResult = await stopTask(ecsClient, ecsCluster, container, taskArn);
        console.log(stopResult);
        resolve({
          success: false,
          exitCode: 127,
          taskArn: taskArn,
          wasStopped: true
        });
      })
    }

  })

}

/* istanbul ignore next */
if (require.main === module) {
  const awsCredentials = getAwsCredentials();
  console.log(`AWS Credentials.accessKeyId = ${awsCredentials.accessKeyId.substring(1,3)}*******`);
  console.log(`AWS Region = ${awsCredentials.region}`);

  const ecsCluster:string = getInput("ecs_cluster")!;
  const ecsTaskDefinition:string = getInput("ecs_task_definition")!;
  const securityGroupIds = getInput("security_group_ids")!.trim().split(",") as SecurityGroupId[];
  const subnets = getInput("subnets")!.trim().split(",") as SubnetId[];
  const container:string = getInput("container")!;
  const commandDelim = getInput("command_delim")?.trim() || ",";
  const commandRaw = getInput("command")!.trim();
  const command = commandRaw.split(commandDelim);
  const tagsChain = getInput("tags");  
  let tags: Tag[] | undefined = undefined;
  if (tagsChain) {
    tags = tagsChain.trim().split(";").map(rawTag=>{
      const [key,value] = rawTag.split(':');
      if (key && value){
        return {key,value};
      }
      return null;    
    }).filter(tag=>!!tag) as Tag[];
  }
  const group = getInput("group");

  console.log(`ecsCluster = ${ecsCluster}`);
  console.log(`ecsTaskDefinition = ${ecsTaskDefinition}`);
  console.log(`securityGroupIds = ${securityGroupIds}`);
  console.log(`subnets = ${subnets}`);
  console.log(`container = ${container}`);
  console.log(`commandDelim = ${commandDelim}`);
  console.log(`command = ${commandRaw}`);
  console.log(`tagsChain = ${tagsChain}`);
  console.log(`command = ${command}`);
  console.log(`tags`, tags);
  console.log(`group = ${group}`);

  const ecsClient = new ECSClient({
    credentials: {
      accessKeyId: awsCredentials.accessKeyId,
      secretAccessKey: awsCredentials.secretAccessKey,
    },
    region: awsCredentials.region,
  });
  run(
      process,
      ecsClient,
      ecsCluster,
      ecsTaskDefinition,
      subnets,
      securityGroupIds,
      container,
      command,
      undefined,
      tags,
      group,
  ).then((result) => {
      const taskId = result.taskArn.split(`/`).reverse()[0];      
      const env = ecsTaskDefinition.split(`-`).reverse()[0];
      console.log(`AWS Cloudwatch logs from the task are here:`);
      console.log(`https://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#logsV2:log-groups/log-group/$252Fecs$252F${env}$252Flcv-management/log-events/lcv-management$252Flcv-management$252F${taskId}`);
    
      core.setOutput('success', result.success);
      core.setOutput('exit_code', result.exitCode);
      core.setOutput('task_arn', result.taskArn);
      if (result.exitCode !== 0){
        core.setFailed("Exit code not zero");
      }
    })
    .catch((e) => {
      core.setFailed(e);
      core.setOutput('success', false);
      throw e;
    });
}
