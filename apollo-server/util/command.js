const {
  hasYarn,
  hasProjectYarn
} = require('@vue/cli-shared-utils')

const execa = require('execa')
const { loadOptions } = require('@vue/cli/lib/options')

exports.getCommand = function (cwd = undefined) {
  if (!cwd) {
    return loadOptions().packageManager || (hasYarn() ? 'yarn' : 'npm')
  }
  return hasProjectYarn(cwd) ? 'yarn' : 'npm'
}

exports.executeCommand = function (command, args, cwd) {
  if (!args) { [command, ...args] = command.split(/\s+/) }
  return execa(command, args, { cwd })
}
