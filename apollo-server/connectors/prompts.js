// Utils
const { get, set, unset } = require('@vue/cli-shared-utils')
const { log } = require('../util/logger')

const promptsMap = new Map()
const answersMap = new Map()

function generatePromptError (value) {
  let message
  if (typeof value === 'string') {
    message = value
  } else {
    message = 'Invalid input'
  }
  return {
    message
  }
}

async function getEnabled (value) {
  const type = typeof value
  if (type === 'function') {
    const result = await value(answers)
    return !!result
  } else if (type === 'boolean') {
    return value
  } else {
    return true
  }
}

function validateInput (prompt, value) {
  const validate = prompt.raw.validate
  if (typeof validate === 'function') {
    return validate(value, answers)
  }
  return true
}

function getFilteredValue (prompt, value) {
  const filter = prompt.raw.filter
  if (typeof filter === 'function') {
    return filter(value)
  }
  return value
}

function getTransformedValue (prompt, value) {
  const transformer = prompt.raw.transformer
  if (typeof transformer === 'function') {
    return transformer(value, answers)
  }
  return value
}

function generatePromptChoice (prompt, data, defaultValue) {
  return {
    value: JSON.stringify(getTransformedValue(prompt, data.value)),
    name: data.name,
    checked: data.checked,
    disabled: data.disabled,
    isDefault: data.value === defaultValue
  }
}

async function getChoices (prompt) {
  const taskId = prompt.taskId
  const data = prompt.raw.choices
  if (!data) {
    return null
  }

  let result
  if (typeof data === 'function') {
    result = await data(answersMap.get(taskId))
  } else {
    result = data
  }
  let defaultValue
  if (prompt.type === 'list' || prompt.type === 'rawlist') {
    defaultValue = await getDefaultValue(prompt)
  }
  return result.map(
    item => generatePromptChoice(prompt, item, defaultValue)
  )
}

function setAnswer (taskId, answerId, value) {
  set(getAnswers(taskId), answerId, value)
}

function removeAnswer (taskId, answerId) {
  unset(getAnswers(taskId), answerId)
}

function generatePrompt (data) {
  return {
    id: data.name,
    type: data.type,
    visible: true,
    enabled: true,
    name: data.short || null,
    message: data.message,
    group: data.group || null,
    description: data.description || null,
    link: data.link || null,
    choices: null,
    value: null,
    valueChanged: false,
    error: null,
    tabId: data.tabId || null,
    raw: data,
    taskId: data.taskId
  }
}

async function updatePrompts (taskId) {
  let prompts = promptsMap.get(taskId)
  if (!prompts) {
    promptsMap.set(taskId, prompts = [])
  }

  for (const prompt of prompts) {
    const oldVisible = prompt.visible
    prompt.visible = await getEnabled(prompt.raw.when)

    prompt.choices = await getChoices(prompt)

    if (oldVisible !== prompt.visible && !prompt.visible) {
      removeAnswer(taskId, prompt.id)
      prompt.valueChanged = false
    } else if (prompt.visible && !prompt.valueChanged) {
      let value
      let answer = getAnswer(taskId, prompt.id)
      if (typeof answer !== 'undefined') {
        value = await getTransformedValue(prompt, answer)
      } else if (typeof prompt.raw.value !== 'undefined') {
        value = prompt.raw.value
      } else {
        value = await getDefaultValue(prompt)
      }
      prompt.rawValue = value
      prompt.value = JSON.stringify(value)
      const finalValue = await getFilteredValue(prompt, value)
      setAnswer(taskId, prompt.id, finalValue)
    }
  }
  log('Prompt answers', getAnswers(taskId))
}

// Public API

async function setAnswers (taskId, newAnswers = {}) {
  answersMap.set(taskId, newAnswers)
  await updatePrompts(taskId)
}

async function changeAnswers (cb) {
  cb(answers)
  await updatePrompts()
}

function getAnswers (taskId) {
  return answersMap.get(taskId) || {}
}

function getAnswer (taskId, answerId) {
  return get(getAnswers(taskId), answerId)
}

async function reset (taskId) {
  promptsMap.delete(taskId)
  await setAnswers(taskId)
}

function list (taskId) {
  return promptsMap.get(taskId)
}

function add (taskId, data) {
  const prompts = promptsMap.get(taskId)
  const prompt = generatePrompt(Object.assign(data, { taskId }))
  prompts.push(prompt)
  return prompt
}

async function start (taskId) {
  await updatePrompts(taskId)
}

// function remove (id) {
//   const index = prompts.findIndex(p => p.id === id)
//   index !== -1 && prompts.splice(index, 1)
// }

async function setValue ({ id, taskId, value }) {
  const prompt = findOne(taskId, id)
  if (!prompt) {
    console.warn(`Prompt '${prompt}' not found`)
    return null
  }

  const validation = await validateInput(prompt, value)
  if (validation !== true) {
    prompt.error = generatePromptError(validation)
  } else {
    prompt.error = null
  }
  prompt.rawValue = value
  const finalValue = await getFilteredValue(prompt, value)
  prompt.value = JSON.stringify(value)
  prompt.valueChanged = true
  setAnswer(taskId, prompt.id, finalValue)
  await updatePrompts(taskId)
  return prompt
}

function findOne (taskId, answerId) {
  const prompts = promptsMap.get(taskId)
  return prompts.find(
    p => p.id === answerId
  )
}

async function getDefaultValue (prompt) {
  let defaultValue = prompt.raw.default
  if (typeof defaultValue === 'function') {
    defaultValue = await defaultValue(answers)
  }

  if (prompt.type === 'checkbox') {
    const choices = prompt.raw.choices
    if (choices) {
      return choices.filter(
        c => c.checked
      ).map(
        c => c.value
      )
    }
  } else if (prompt.type === 'confirm') {
    if (prompt.raw.checked) return true
    return defaultValue || false
  }
  return defaultValue
}

async function answerPrompt ({ id, taskId, value }, context) {
  await setValue({ id, taskId, value: JSON.parse(value) })
  return list(taskId)
}

module.exports = {
  setAnswers,
  changeAnswers,
  getAnswers,
  getAnswer,
  reset,
  list,
  add,
  start,
  setValue,
  findOne,
  getDefaultValue,
  answerPrompt
}
