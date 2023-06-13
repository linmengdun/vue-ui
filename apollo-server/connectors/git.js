const path = require('path')
const fs = require('fs-extra')
const parseDiff = require('../util/parse-diff')
const parseBranch = require('../util/parse-branch')
// Connectors
const cwd = require('./cwd')
const logs = require('./logs')
// Utils
const { execa, hasProjectGit } = require('@vue/cli-shared-utils')

function isSvnProject (url) {
  if (typeof url === 'object' && url.repo) {
    // 传入的是一个project对象
    url = url.repo
  }
  return /^https:\/\/svn-cc\.gz/.test(url)
}

async function getNewFiles (context) {
  if (!hasProjectGit(cwd.get())) return []

  const { stdout } = await execa('git', [
    'ls-files',
    '-o',
    '--exclude-standard',
    '--full-name'
  ], {
    cwd: cwd.get()
  })
  if (stdout.trim()) {
    return stdout.split(/\r?\n/g)
  }
  return []
}

async function clone (repo, dir, context) {
  if (isSvnProject(repo)) {
    await execa('svn', [
      'checkout',
      repo,
      dir
    ])
  } else {
    await execa('git', [
      'clone',
      repo,
      dir
    ])
  }
  return true
}

async function pull(repo, cwd) {
  if (isSvnProject(repo)) {
    await execa('svn', ['up'], { cwd })
  } else {
    await execa('git', ['pull'], { cwd })
  }
  return true
}

async function prune(repo, cwd) {
  if (!isSvnProject(repo)) {
    await execa('git', ['remote', 'prune', 'origin'], {cwd})
  }
  return true
}

async function branches (projectId, context) {
  let project

  if (typeof projectId === 'object' && projectId.id) {
    project = projectId
  } else {
    await waitFor(0)
    const projects = require('./projects')
    project = projects.findOne(projectId, context)
  }

  let { repo, path } = project
  // svn projects have no branches
  if (isSvnProject(repo)) {
    return []
  } else {
    const { stdout } = await execa('git', ['branch', '-v', '-a'], { cwd: path })
    return parseBranch(stdout)
  }
}

async function checkout ({ name, projectId }, context) {
  if (!name || !projectId) {
    return false
  }

  await waitFor(0)

  const tasks = require('./tasks')
  const projects = require('./projects')

  // if running task
  const taskList = tasks.list({ projectId }, context)
  if (_.find(taskList, { status: 'running' })) {
    return false
  }

  const { path } = projects.findOne(projectId, context)

  await execa('git', ['checkout', '.'], { cwd: path })
  await execa('git', ['checkout', name], { cwd: path })

  logs.add({
    message: `Project ${ projectId } switch to branch "${ name }"`,
    type: 'info'
  }, context)

  return true
}

async function getDiffs (context) {
  if (!hasProjectGit(cwd.get())) return []

  const { highlightCode } = require('../util/highlight')

  const newFiles = await getNewFiles(context)
  await execa('git', ['add', '-N', '*'], {
    cwd: cwd.get()
  })
  const { stdout } = await execa('git', ['diff'], {
    cwd: cwd.get()
  })
  await reset(context)
  const list = parseDiff(stdout)
  for (const n in list) {
    const fileDiff = list[n]
    const isNew = newFiles.includes(fileDiff.to)
    let fromContent
    if (!isNew) {
      const result = await execa('git', ['show', `HEAD:${fileDiff.from}`], {
        cwd: cwd.get()
      })
      fromContent = result.stdout
    }
    const highlightedContentFrom = fromContent && highlightCode(fileDiff.from, fromContent).split('\n')
    const highlightedContentTo = highlightCode(fileDiff.to, fs.readFileSync(path.resolve(cwd.get(), fileDiff.to), { encoding: 'utf8' })).split('\n')
    for (const chunk of fileDiff.chunks) {
      for (const change of chunk.changes) {
        const firstChar = change.content.charAt(0)
        let highlightedCode
        if (change.normal) {
          highlightedCode = highlightedContentFrom[change.ln1 - 1]
        } else if (change.type === 'del') {
          highlightedCode = highlightedContentFrom[change.ln - 1]
        } else if (change.type === 'add') {
          highlightedCode = highlightedContentTo[change.ln - 1]
        }
        if (highlightedCode) {
          change.content = firstChar + highlightedCode
        }
      }
    }
    list[n] = {
      id: fileDiff.index.join(' '),
      ...fileDiff,
      new: isNew
    }
  }

  return list
}

async function commit (message, context) {
  if (!hasProjectGit(cwd.get())) return false

  await execa('git', ['add', '*'], {
    cwd: cwd.get()
  })
  await execa('git', ['commit', '-m', message.replace(/"/, '\\"')], {
    cwd: cwd.get()
  })
  return true
}

async function reset (context) {
  if (!hasProjectGit(cwd.get())) return false

  await execa('git', ['reset'], {
    cwd: cwd.get()
  })
  return true
}

async function getRoot (context) {
  if (!hasProjectGit(cwd.get())) return cwd.get()

  const { stdout } = await execa('git', [
    'rev-parse',
    '--show-toplevel'
  ], {
    cwd: cwd.get()
  })
  return stdout
}

async function resolveFile (file, context) {
  const root = await getRoot(context)
  return path.resolve(root, file)
}

module.exports = {
  clone,
  isSvnProject,
  getDiffs,
  commit,
  reset,
  getRoot,
  resolveFile,
  pull,
  prune,
  branches,
  checkout
}
