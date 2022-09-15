ECS Run Tasks
===============

GitHub action that calls ecs run task, blocks, and returns the exit code.

Because of [AWS Run Task limitations](https://github.com/aws/containers-roadmap/issues/196),
callers have to look for stdout wherever the task definition sends it. 

This is unsupported code and in a public repository to be used across the org.
