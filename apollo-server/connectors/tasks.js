const { chalk, execa } = require('@vue/cli-shared-utils')
// Subs
const channels = require('../channels')
// Connectors
const cwd = require('./cwd')
const folders = require('./folders')
const logs = require('./logs')
const plugins = require('./plugins')
const prompts = require('./prompts')
const views = require('./views')
const projects = require('./projects')
const git = require('./git')
// Utils
const { log } = require('../util/logger')
const { notify } = require('../util/notification')
const { terminate } = require('../util/terminate')
const { parseArgs } = require('../util/parse-args')

const MAX_LOGS = 2000
const VIEW_ID = 'vue-project-tasks'
const WIN_ENOENT_THRESHOLD = 500 // ms

const tasks = new Map()

function createDefaultTasks ({ path }) {
  return [
    {
      name: 'deploy-beta',
      command: 'ewan beta',
      defaultView: 'org.vue.webpack.views.dashboard',
      icon: '/public/webpack-logo.png',
      description: 'org.vue.vue-webpack.tasks.beta.description',
      needHistory: true,
      views: [
        // {
        //   component: 'org.vue.webpack.components.dashboard',
        //   icon: 'dashboard',
        //   id: 'org.vue.webpack.views.dashboard',
        //   label: 'org.vue.vue-webpack.dashboard.title'
        // },
        // {
        //   component: 'org.vue.webpack.components.analyzer',
        //   icon: 'donut_large',
        //   id: 'org.vue.webpack.views.analyzer',
        //   label: 'org.vue.vue-webpack.analyzer.title'
        // }
      ],
      prompts: [],
      onBeforeRun ({ args, label }) {
        args.push(`--mode beta`)
        args.push(`--label ${ label }`)
      }
    },
    {
      name: 'deploy-prod',
      command: 'ewan release',
      defaultView: 'org.vue.webpack.views.dashboard',
      icon: '/public/webpack-logo.png',
      description: 'org.vue.vue-webpack.tasks.build.description',
      needHistory: true,
      views: [],
      prompts: [
        /* {
          name: 'qa',
          type: 'list',
          default: '黄丽如',
          description: 'org.vue.vue-webpack.tasks.build.qa',
          choices () {
            return require('../../locales/qa.json').users
          }
        }, */
        {
          name: 'msg',
          type: 'input',
          description: 'org.vue.vue-webpack.tasks.build.msg'
        },
      ],
      async onBeforeRun ({ args, answers, project, taskId, context }) {
        args.push(`--mode production`)
        args.push(`--message ${ answers.msg }`)
        args.push(`--contributor ${ context.auth['openid.sreg.fullname'] }`)

        //检查当前的分支，针对Git
        git.branches(project).then(branches => {
          for(let i = 0, branch; branch = branches[i]; i++) {
            if (branch.current) {
              // if (branch.name !== 'master') {
              //   addLog({
              //     taskId,
              //     type: 'stdout',
              //     text: chalk.red(`Warning: current packing branch '${ branch.name }' isn't master\n`)
              //   }, context)
              // }
              
              // 输出当前的日志内容
              return addLog({
                taskId,
                type: 'stdout',
                text: `Last commit: ${ branch.commit } ${ branch.label }\n`
              }, context)
            }
          }
        })
      },
      // 进行代码检查
      async onExit ({ code, answers, context: { auth }, project }) {
        if (code === 0) {
          await execa('python', [
            CODECHECKER_CMD,
            `--project_id ${ project.id }`,
            `--project_name ${ project.name }`,
            `--project_dir ${ project.path }`,
            `--qa ${ answers.qa }`,
            `--operator ${ auth['openid.sreg.fullname'] }`,
            `--config_file ${ CODECHECKER_DIR }config.json`
          ], { shell: true })
        }
      }
    }
  ]
}

function getTasks (file = null) {
  if (!file) file = cwd.get()
  let list = tasks.get(file)
  if (!list) {
    list = []
    tasks.set(file, list)
  }
  return list
}

async function list ({ projectId, api = true } = {}, context) {
  let list = getTasks(projectId)
  const project = projects.findOne(projectId, context)

  if (list.length < 1) {
    // Get current valid tasks in project `package.json`
    const defaultTasks = createDefaultTasks(project)

    tasks.set(projectId, list = defaultTasks.map(task => {
      return {
        id : `${projectId}:${task.name}`,
        logs: [],
        status: 'idle',
        path: project.path,
        ...task
      }
    }))
  }

  return list
}

function findOne (id, context) {
  for (const [, list] of tasks) {
    const result = list.find(t => t.id === id)
    if (result) return result
  }
}

function getSavedData (id, context) {
  let data = context.db.get('tasks').find({
    id
  }).value()
  // Clone
  if (data != null) data = JSON.parse(JSON.stringify(data))
  return data
}

function updateSavedData (data, context) {
  if (getSavedData(data.id, context)) {
    context.db.get('tasks').find({ id: data.id }).assign(data).write()
  } else {
    context.db.get('tasks').push(data).write()
  }
}

function getPrompts (id, context) {
  return restoreParameters({ id }, context)
}

function updateOne (data, context) {
  const task = findOne(data.id)
  if (task) {
    if (task.status !== data.status) {
      updateViewBadges({
        task,
        data
      }, context)
    }

// update history
const taskData = getSavedData(data.id, context)
if (taskData) {
  if (task.needHistory) {
    Object.assign(taskData.history[0], { status: data.status })
  }
  updateSavedData(taskData, context)
}

    Object.assign(task, data)
    context.pubsub.publish(channels.TASK_CHANGED, {
      taskChanged: task
    })
  }
  return task
}

function updateViewBadges ({ task, data }, context) {
  const viewId = VIEW_ID

  // New badges
  if (data) {
    if (data.status === 'error') {
      views.addBadge({
        viewId,
        badge: {
          id: 'vue-task-error',
          type: 'error',
          label: 'org.vue.components.view-badge.labels.tasks.error',
          priority: 3
        }
      }, context)
    } else if (data.status === 'running') {
      views.addBadge({
        viewId,
        badge: {
          id: 'vue-task-running',
          type: 'info',
          label: 'org.vue.components.view-badge.labels.tasks.running',
          priority: 2
        }
      }, context)
    } else if (data.status === 'done') {
      views.addBadge({
        viewId,
        badge: {
          id: 'vue-task-done',
          type: 'success',
          label: 'org.vue.components.view-badge.labels.tasks.done',
          priority: 1,
          hidden: true
        }
      }, context)
    }
  }

  // Remove previous badges
  if (task.status === 'error') {
    views.removeBadge({ viewId, badgeId: 'vue-task-error' }, context)
  } else if (task.status === 'running') {
    views.removeBadge({ viewId, badgeId: 'vue-task-running' }, context)
  } else if (task.status === 'done') {
    views.removeBadge({ viewId, badgeId: 'vue-task-done' }, context)
  }
}

async function run (id, context) {
  const task = findOne(id, context)
  if (task && task.status !== 'running') {
    task._terminating = false

    // Answers
    const answers = prompts.getAnswers()
    let [command, ...args] = parseArgs(task.command)

    // Output colors
    // See: https://www.npmjs.com/package/supports-color
    process.env.FORCE_COLOR = 1

    const [ projectId ] = id.split(':')
    const currentProject = projects.findOne(projectId, context)
    const cwd = currentProject.path
    
    try {
      await git.pull(currentProject.repo, cwd)
    } catch(e) {
      addLog({
        taskId: task.id,
        type: 'stdout',
        text: `${ e }`
      }, context)
    }

    // Plugin API
    if (task.onBeforeRun) {
      if (!answers.$_overrideArgs) {
        const origPush = args.push.bind(args)
        args.push = (...items) => {
          if (items.length && args.indexOf(items[0]) !== -1) return items.length
          return origPush(...items)
        }
      }
      await task.onBeforeRun({
        args,
        label,
        context,
        answers,
        taskId: id,
        project: currentProject
      })
    }

    // Deduplicate arguments
    /* const dedupedArgs = []
    for (let i = args.length - 1; i >= 0; i--) {
      const arg = args[i]
      if (typeof arg === 'string' && arg.indexOf('--') === 0) {
        if (dedupedArgs.indexOf(arg) === -1) {
          dedupedArgs.push(arg)
        } else {
          const value = args[i + 1]
          if (value && value.indexOf('--') !== 0) {
            dedupedArgs.pop()
          }
        }
      } else {
        dedupedArgs.push(arg)
      }
    }
    args = dedupedArgs.reverse()

    if (command === 'npm') {
      args.splice(0, 0, '--')
    } */

    log('Task run', command, args)

    // add history
    if (task.needHistory) {
      addHistory({
        id: label,
        taskId: id
      }, context)
    }

    updateOne({
      id: task.id,
      status: 'running'
    }, context)
    logs.add({
      message: `Task ${task.id} started`,
      type: 'info'
    }, context)

    addLog({
      taskId: task.id,
      type: 'stdout',
      text: chalk.grey(`$ ${command} ${args.join(' ')}`)
    }, context)

    task.time = Date.now()

    // Task env
    process.env.VUE_CLI_CONTEXT = cwd.get()
    process.env.VUE_CLI_PROJECT_ID = projects.getCurrent(context).id
    const nodeEnv = process.env.NODE_ENV
    delete process.env.NODE_ENV

    const child = execa(command, args, {
      cwd: cwd.get(),
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true
    })

    if (typeof nodeEnv !== 'undefined') {
      process.env.NODE_ENV = nodeEnv
    }

    task.child = child

    const outPipe = logPipe(queue => {
      addLog({
        taskId: task.id,
        type: 'stdout',
        text: queue
      }, context)
    })
    child.stdout.on('data', buffer => {
      outPipe.add(buffer.toString())
    })

    const errPipe = logPipe(queue => {
      addLog({
        taskId: task.id,
        type: 'stderr',
        text: queue
      }, context)
    })
    child.stderr.on('data', buffer => {
      errPipe.add(buffer.toString())
    })

    const onExit = async (code, signal) => {
      outPipe.flush()
      errPipe.flush()

      log('Task exit', command, args, 'code:', code, 'signal:', signal)

      const duration = Date.now() - task.time
      const seconds = Math.round(duration / 10) / 100
      addLog({
        taskId: task.id,
        type: 'stdout',
        text: chalk.grey(`Total task duration: ${seconds}s`)
      }, context)

      // Plugin API
      if (task.onExit) {
        try {
          await task.onExit({
            args,
            child,
            cwd: cwd,
            code,
            signal,
            context,
            answers,
            project: currentProject
          })
        } catch (e) {
          console.log(e)
        }
      }

      if (code === null || task._terminating) {
        updateOne({
          id: task.id,
          status: 'terminated'
        }, context)
        logs.add({
          message: `Task ${task.id} was terminated`,
          type: 'info'
        }, context)
      } else if (code !== 0) {
        updateOne({
          id: task.id,
          status: 'error'
        }, context)
        logs.add({
          message: `Task ${task.id} ended with error code ${code}`,
          type: 'error'
        }, context)
        notify({
          title: 'Task error',
          message: `Task ${task.id} ended with error code ${code}`,
          icon: 'error'
        })
      } else {
        updateOne({
          id: task.id,
          status: 'done'
        }, context)
        logs.add({
          message: `Task ${task.id} completed`,
          type: 'done'
        }, context)
        notify({
          title: 'Task completed',
          message: `Task ${task.id} completed in ${seconds}s.`,
          icon: 'done'
        })
      }

      plugins.callHook({
        id: 'taskExit',
        args: [{
          task,
          args,
          child,
          cwd: cwd.get(),
          signal,
          code
        }],
        file: cwd.get()
      }, context)
    }

    child.on('exit', onExit)

    child.on('error', error => {
      const duration = Date.now() - task.time
      // hackish workaround for https://github.com/vuejs/vue-cli/issues/2096
      if (process.platform === 'win32' && error.code === 'ENOENT' && duration > WIN_ENOENT_THRESHOLD) {
        return onExit(null)
      }
      updateOne({
        id: task.id,
        status: 'error'
      }, context)
      logs.add({
        message: `Error while running task ${task.id} with message'${error.message}'`,
        type: 'error'
      }, context)
      notify({
        title: 'Task error',
        message: `Error while running task ${task.id} with message'${error.message}'`,
        icon: 'error'
      })
      addLog({
        taskId: task.id,
        type: 'stdout',
        text: chalk.red(`Error while running task ${task.id} with message '${error.message}'`)
      }, context)
      console.error(error)
    })

    // Plugin API
    if (task.onRun) {
      await task.onRun({
        args,
        child,
        cwd: cwd.get()
      })
    }

    plugins.callHook({
      id: 'taskRun',
      args: [{
        task,
        args,
        child,
        cwd: cwd.get()
      }],
      file: cwd.get()
    }, context)
  }
  return task
}

async function stop (id, context) {
  const task = findOne(id, context)
  if (task && task.status === 'running' && task.child) {
    task._terminating = true
    try {
      const { success, error } = await terminate(task.child, cwd.get())
      if (success) {
        updateOne({
          id: task.id,
          status: 'terminated'
        }, context)
      } else if (error) {
        throw error
      } else {
        throw new Error('Unknown error')
      }
    } catch (e) {
      console.log(chalk.red(`Can't terminate process ${task.child.pid}`))
      console.error(e)
    }
  }
  return task
}

function addLog (log, context) {
  const task = findOne(log.taskId, context)
  if (task) {
    if (task.logs.length === MAX_LOGS) {
      task.logs.shift()
    }
    task.logs.push(log)
    context.pubsub.publish(channels.TASK_LOG_ADDED, {
      taskLogAdded: log
    })
  }
}

function clearLogs (id, context) {
  const task = findOne(id, context)
  if (task) {
    task.logs = []
  }
  return task
}

function open (id, context) {
  const task = findOne(id, context)
  plugins.callHook({
    id: 'taskOpen',
    args: [{
      task,
      cwd: cwd.get()
    }],
    file: cwd.get()
  }, context)
  return true
}

function logPipe (action) {
  const maxTime = 300

  let queue = ''
  let size = 0
  let time = Date.now()
  let timeout

  const add = (string) => {
    queue += string
    size++

    if (size === 50 || Date.now() > time + maxTime) {
      flush()
    } else {
      clearTimeout(timeout)
      timeout = setTimeout(flush, maxTime)
    }
  }

  const flush = () => {
    clearTimeout(timeout)
    if (!size) return
    action(queue)
    queue = ''
    size = 0
    time = Date.now()
  }

  return {
    add,
    flush
  }
}

function saveParameters ({ id }, context) {
  // Answers
  const answers = prompts.getAnswers(id)

  // Save parameters
  updateSavedData({
    id,
    answers
  }, context)

  return prompts.list(id)
}

async function restoreParameters ({ id }, context) {
  const task = findOne(id, context)
  if (task) {
    await prompts.reset(id)
    task.prompts.forEach(prompt => prompts.add(id, prompt))
    const data = getSavedData(id, context)
    if (data) {
      await prompts.setAnswers(id, data.answers)
    }
    await prompts.start(id)
  }
  return prompts.list(id)
}

function addHistory ({ id, taskId }, context) {
  let history = [{ id }]
  let taskData = getSavedData(taskId, context)
  
  if (taskData && taskData.history) {
    if (taskData.history.find(item => item.id === id)) {
      history = taskData.history
    } else {
      history = history.concat(taskData.history)
    }
  }

  updateSavedData({
    id: taskId,
    history: history.slice(0, 10) // 保存10条记录就好
  }, context)
}

function getHistory (taskId, context) {
  const savedData = getSavedData(taskId, context)
  return savedData
    ? savedData.history
    : []
}

function getHistoryHomepage ({ projectId, id }, context) {
  // const project = projects.findOne(projectId, context)
  // const config = folders.readConfig(project.path)
  // return `http://fe.dev.cc.163.com/beta/${ config.deploy.dir }/${ id }/`
  return ''
}
module.exports = {
  list,
  findOne,
  getPrompts,
  run,
  stop,
  updateOne,
  clearLogs,
  getHistory,
  getHistoryHomepage,
  open,
  saveParameters,
  restoreParameters
}
