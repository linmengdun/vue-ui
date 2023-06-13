const gql = require('graphql-tag')
// Subs
const { withFilter } = require('graphql-subscriptions')
const channels = require('../channels')
// Connectors
const tasks = require('../connectors/tasks')
const plugins = require('../connectors/plugins')
const projects = require('../connectors/projects')

exports.types = gql`
extend type Query {
  tasks (projectId: ID!): [Task]
  task (id: ID!): Task
}

extend type Mutation {
  taskRun (id: ID!, args: String): Task
  taskStop (id: ID!): Task
  taskLogsClear (id: ID!): Task
  taskOpen (id: ID!): Boolean
  taskSaveParameters (id: ID!): [Prompt]
  taskRestoreParameters (id: ID!): [Prompt]
}

extend type Subscription {
  taskChanged: Task
  taskLogAdded (id: ID!): TaskLog
}

type Task implements DescribedEntity {
  id: ID!
  status: TaskStatus!
  command: String!
  name: String
  description: String
  link: String
  icon: String
  logs: [TaskLog]
  prompts: [Prompt]
  views: [TaskView]
  history: [TaskHistory]
  defaultView: String
  project: Project
  needHistory: Boolean
}

enum TaskStatus {
  idle
  running
  done
  error
  terminated
}

type TaskLog {
  taskId: ID!
  type: TaskLogType!
  text: String
}

type TaskHistory {
  id: ID!
  status: String
  homepage: String
}

enum TaskLogType {
  stdout
  stderr
}

type TaskView {
  id: ID!
  label: String!
  component: String!
  icon: String
}
`

exports.resolvers = {
  Task: {
    prompts: (task, args, context) => tasks.getPrompts(task.id, context),
    project: (task, args, context) => projects.findByPath(task.path, context),
    history: (task, args, context) => tasks.getHistory(task.id, context)
  },

  TaskHistory: {
    homepage: (history, args, context) => tasks.getHistoryHomepage(history, context)
  },

  Query: {
    tasks: (root, { projectId }, context) => tasks.list({ projectId }, context),
    task: (root, { id }, context) => tasks.findOne(id, context)
  },

  Mutation: {
    taskRun: (root, { id, args }, context) => tasks.run({ id, args }, context),
    taskStop: (root, { id }, context) => tasks.stop(id, context),
    taskLogsClear: (root, { id }, context) => tasks.clearLogs(id, context),
    taskOpen: (root, { id }, context) => tasks.open(id, context),
    taskSaveParameters: (root, { id }, context) => tasks.saveParameters({ id }, context),
    taskRestoreParameters: (root, { id }, context) => tasks.restoreParameters({ id }, context)
  },

  Subscription: {
    taskChanged: {
      subscribe: (parent, args, { pubsub }) => pubsub.asyncIterator(channels.TASK_CHANGED)
    },
    taskLogAdded: {
      subscribe: withFilter(
        (parent, args, { pubsub }) => pubsub.asyncIterator(channels.TASK_LOG_ADDED),
        (payload, vars) => payload.taskLogAdded.taskId === vars.id
      )
    }
  }
}
