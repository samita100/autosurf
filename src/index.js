import BaseAdapter from './adapters/BaseAdapter'
import WebSurf from './adapters/WebSurf'

class Private {
  static STATUS_SUCCESS = true
  static STATUS_ERROR = false

  static Surf = null

  static config = {
    autoAdvance: true,
    defaultFailMessage: 'Something went wrong',
    typingSpeed: 500,
  }

  static actionables = []
  static schedules = []
  static results = []
  static events = {}
  static allEvents = [
    'actionError',
    'actionFailed',
    'actionStart',
    'actionSuccess',
    'done',
    'paused',
    'resumed',
    'scheduleFinish',
    'scheduleInit',
    'scheduleStart',
  ]
  static customHandlers = {}

  static canStart = false
  static isDone = false
  static isInitialized = false
  static isLoading = false
  static isPaused = false
  static isReady = false
  static isWorking = false
  static isWaiting = false

  static current = null
  static currentAction = null
  static currentIndex = null
  static currentSchedule = null
  static toResume = null

  static startLoopCount = 0

  /**
   * @inheritdoc
   */
  toJSON() {
    return {
      actionables: Private.actionables,
      config: Private.config,
      schedules: Private.schedules,
      results: Private.results,
      canStart: Private.canStart,
      isDone: Private.isDone,
      isInitialized: Private.isInitialized,
      isLoading: Private.isLoading,
      isPaused: Private.isPaused,
      isReady: Private.isReady,
      isWaiting: Private.isWaiting,
      isWorking: Private.isWorking,
      current: Private.current,
      currentAction: Private.currentAction,
      currentIndex: Private.currentIndex,
      currentSchedule: Private.currentSchedule,
      toResume: Private.toResume,
    }
  }
}

export default class AutoSurf {
  /**
   * @param {object} config The options. Keys include:
   * autoAdvance (boolean): Indicates whether to automatically advance to the next step or not. Defaults to TRUE
   * defaultFailMessage (string): The default message for failed actions. It may be overridden by a more specific message, if available.
   * typingSpeed (integer): The speed to type at. Defaults to 500
   * @param {BaseAdapter} Adapter A subclass of BaseAdapter
   */
  constructor(config = {}, Adapter) {
    this.version = '1.0.0'

    if (!Adapter) {
      Adapter = WebSurf
    } else if (typeof Adapter !== 'function') {
      throw new Error('Adapter must be a class')
    } else if (!(new Adapter() instanceof BaseAdapter)) {
      throw new Error('Adapter must be a subclass of BaseAdapter')
    }

    Private.Surf = Adapter

    Private.config = {
      ...Private.config,
      ...config,
    }

    Private.customHandlers.doGoto = this.#handleDoGoto
    Private.customHandlers.doPause = this.#handleDoPause
    Private.customHandlers.doWait = this.#handleDoWait
  }

  getBackupData() {
    return new Private()
  }

  /**
   * @param {string} event paused | resumed | scheduleStart | scheduleInit |
   * scheduleFinish | actionStart | actionSuccess | actionFailed | actionError | done
   * @param {function} callback
   * @returns {AutoSurf}
   */
  on(event, callback) {
    if (event === '*') {
      Private.allEvents.forEach((evt) => (Private.events[evt] = callback))
    } else {
      event.split(',').forEach((evt) => (Private.events[evt.trim()] = callback))
    }

    return this
  }

  schedules(schedules) {
    if (!Array.isArray(schedules)) {
      throw new Error('Schedules must be an array')
    }

    Private.schedules = schedules
    this.#parseSchedules()

    return this
  }

  /**
   * Pauses the execution of the schedules
   * @returns {AutoSurf}
   */
  pause() {
    if (Private.isPaused) {
      return this
    }

    Private.isReady = false
    Private.isPaused = true

    this.#trigger('paused', {
      scheduleIndex: Private.currentSchedule,
      actionIndex: Private.currentIndex,
      action: Private.currentAction,
      on: Private.current,
    })

    return this
  }

  /**
   * Called to inform AutoSurf that parent code is ready
   * @param {function} callback The function to call when everything is ready
   */
  ready(callback = () => {}) {
    this.#initAdapter(callback)

    Private.canStart = true

    return this
  }

  /**
   * Reconfigures the surfer
   * @param {object} config Keys include:
   * autoAdvance (boolean): Indicates whether to automatically advance to the next step or not. Defaults to TRUE
   * defaultFailMessage (string): The default message for failed actions. It may be overridden by a more specific message, if available.
   * typingSpeed (integer): The speed to type at. Defaults to 500
   */
  reconfigure(config) {
    Private.config = { ...Private.config, ...config }

    return this
  }

  /**
   * Restarts execution
   * @returns {AutoSurf}
   */
  restart() {
    if (Private.isLoading) {
      setTimeout(() => this.restart(), 1000)
    }

    this.#trigger('reset', {})

    this.#parseSchedules()

    Private.currentSchedule = -1
    Private.isDone = true
    Private.results = []

    this.#nextSchedule()

    return this
  }

  /**
   * Resumes the execution of the schedules
   * @returns {AutoSurf}
   */
  resume() {
    if (!Private.isPaused) {
      return this
    }

    this.#trigger('resumed', {
      scheduleIndex: Private.currentSchedule,
      actionIndex: Private.currentIndex,
      action: Private.currentAction,
      on: Private.current,
    })

    Private.isReady = true
    Private.isPaused = false

    if (this.#scheduleIsEmpty()) {
      this.#nextSchedule()
    } else if (Private.toResume === 2) {
      this.#checkNext()
    } else {
      this.#doNext()
    }

    return this
  }

  /**
   * Initiates execution
   * @param {object} config Keys include:
   * autoAdvance (boolean): Indicates whether to automatically advance to the next step or not. Defaults to TRUE
   * defaultFailMessage (string): The default message for failed actions. It may be overridden by a more specific message, if available.
   * typingSpeed (integer): The speed to type at. Defaults to 500
   * @return {AutoSurf}
   */
  start(config = {}) {
    if (!Private.canStart) {
      throw new Error('You have to call ready first')
    }

    // Don't continue until loading is done
    if (Private.isLoading || !Private.schedules.length) {
      if (Private.startLoopCount < 10) {
        Private.startLoopCount++

        setTimeout(() => this.start(config, false), 1000)
      }

      return this
    }

    Private.currentSchedule = -1
    Private.isDone = true
    Private.config = { ...Private.config, ...config }

    this.#nextSchedule()

    return this
  }

  #checkNext(fresh) {
    try {
      Private.currentAction = 'check'
      Private.toResume = 2

      if (fresh) {
        Private.currentIndex = 0
      } else {
        Private.currentIndex++
      }

      if (
        Private.isReady &&
        !Private.isLoading &&
        Private.actionables[Private.currentSchedule]
      ) {
        if (Private.actionables[Private.currentSchedule].toCheck.length) {
          Private.current = Private.actionables[
            Private.currentSchedule
          ].toCheck.shift()

          if (Private.current) {
            this.#startWorking()

            const { action, params, selector } = Private.current

            let _action = action

            if (action.toLowerCase().indexOf('not') !== -1) {
              _action = action.replace(/not/i, '')
            }

            Private.isReady = false
            this.#handle(_action, params, selector, (status) =>
              this.#verify(action, status)
            )
          }
        } else {
          this.#finishSchedule()
        }
      }
    } catch (e) {
      Private.isReady = true
      this.#fail(e.message)

      if (Private.config.autoAdvance) {
        this.#checkNext()
      } else {
        this.pause()
      }
    }
  }

  #done() {
    if (Private.current !== null) {
      Private.current = null
      Private.isReady = false
      Private.isDone = true

      this.#stopWorking()

      // trigger done
      Private.Surf.quit(this)
      this.#trigger('done', Private.results)
    }
  }

  #doNext(fresh) {
    try {
      Private.currentAction = 'do'
      Private.toResume = 1

      if (fresh) {
        Private.currentIndex = 0
      } else {
        Private.currentIndex++
      }

      if (
        Private.isReady &&
        !Private.isLoading &&
        Private.actionables[Private.currentSchedule]
      ) {
        if (Private.actionables[Private.currentSchedule].toDo.length) {
          Private.current = Private.actionables[
            Private.currentSchedule
          ].toDo.shift()

          if (Private.current) {
            const { action, params = [], selector } = Private.current

            Private.isReady = false

            if (action === 'type' && params.length < 3) {
              params.push(Private.config.typingSpeed)
            }

            this.#handle(action, params, selector, (status) =>
              this.#handled(status)
            )
          }
        } else {
          // nothing to do
          this.#checkNext(true)
        }
      }
    } catch (e) {
      this.#fail(e.message)

      if (Private.config.autoAdvance) {
        this.#doNext()
      } else {
        this.pause()
      }
    }
  }

  #fail(message = 'Something went wrong') {
    try {
      this.#stopWorking()

      // save to result

      if (Private.results.length <= Private.currentSchedule) {
        Private.results.push({
          title: Private.schedules[Private.currentSchedule].title,
          list: [],
          passed: 0,
          failed: 0,
        })
      }

      Private.results[Private.currentSchedule]['failed']++
      Private.results[Private.currentSchedule]['list'].push({
        action: Private.currentAction,
        index: this.currentIndex,
        description: Private.current.description,
        is_succes: false,
      })

      // trigger failed

      this.#trigger('actionFailed', {
        scheduleIndex: Private.currentSchedule,
        actionIndex: Private.currentIndex,
        action: Private.currentAction,
        on: Private.current,
        message,
      })
    } catch (e) {}

    return this
  }

  #finishSchedule() {
    if (this.#scheduleIsEmpty()) {
      if (!Private.isDone) {
        this.#trigger('scheduleFinish', {
          scheduleIndex: Private.currentSchedule,
        })
      }

      Private.isDone = true

      if (!this.#hasNext()) {
        this.#done()
      } else if (Private.config.autoAdvance) {
        this.#nextSchedule()
      } else {
        this.pause()
      }
    }
  }

  #handle(action, params, selector, callback) {
    const ucase = (str) => str.replace(/^[a-z]/i, (chr) => chr.toUpperCase())
    const method = `${Private.currentAction}${ucase(action)}`

    this.#startWorking()

    try {
      Private.Surf.doFocus(selector)
    } catch (e) {}

    if (Private.customHandlers[method]) {
      Private.customHandlers[method].call(this, callback, selector, params)
    } else {
      try {
        if (selector) {
          params.unshift(selector)
        }

        Private.Surf.setSuccessCallback(() => {
          callback(Private.STATUS_SUCCESS)
        })

        Private.Surf.setErrorCallback(() => {
          callback(Private.STATUS_ERROR)
        })

        Private.Surf[method](...params)
      } catch (e) {
        this.#fail(e.message)

        callback(Private.STATUS_ERROR)
      }
    }
  }

  #handled(status) {
    if (status === Private.STATUS_SUCCESS) {
      this.#success()
    } else {
      this.#fail()
    }

    if (!Private.isPaused && !Private.isDone && !Private.isWaiting) {
      Private.isReady = true
      Private.isLoading = false

      if (Private.config.autoAdvance) {
        this.#doNext()
      } else {
        if (this.#scheduleIsEmpty()) {
          this.#finishSchedule()
        } else {
          this.pause()
        }
      }
    }

    return this
  }

  #handleDoGoto(callback, selector, urlParams) {
    if (!urlParams.length) {
      return callback(Private.STATUS_ERROR)
    }

    if (Private.currentSchedule === undefined) {
      // only load page if started
      setTimeout(() => this.#handleDoGoto(callback, selector, urlParams), 1000)
    } else {
      Private.isReady = false
      Private.isLoading = true

      try {
        Private.Surf.doGoto(...urlParams)

        callback(Private.STATUS_SUCCESS)
      } catch (e) {
        callback(Private.STATUS_ERROR)
      }
    }

    return this
  }

  #handleDoPause(callback) {
    this.pause()

    callback(Private.STATUS_SUCCESS)
  }

  #handleDoWait(callback, selector, millisecondsParam) {
    try {
      this.#waiting()

      Private.Surf.doWait(...millisecondsParam)

      this.#waiting(false)

      callback(Private.STATUS_SUCCESS)
    } catch (e) {
      this.#waiting(false)

      callback(Private.STATUS_ERROR)
    }
  }

  #hasNext() {
    return Private.actionables[Private.currentSchedule + 1] !== undefined
  }

  #initAdapter(callback) {
    Private.Surf.init(this, (fromStore) => {
      if (fromStore) {
        const allowedKeys = Object.keys(new Private().toJSON())

        for (let key in fromStore) {
          if (!allowedKeys.includes(key)) {
            return
          }

          Private[key] = fromStore[key]
        }
      }

      if (Private.isWorking) {
        this.#handled(Private.STATUS_SUCCESS)
      }

      callback(!!fromStore)
    })
  }

  #nextSchedule() {
    if (!Private.isDone) {
      return this
    }

    if (!this.#hasNext()) {
      this.#done()

      return this
    }

    Private.currentSchedule++
    Private.isReady = true
    Private.isDone = false

    this.#trigger('scheduleStart', {
      scheduleIndex: Private.currentSchedule,
    })

    this.#doNext(true)

    return this
  }

  #parseSchedules() {
    Private.isLoading = true

    Private.schedules.forEach((schedule, i) => {
      schedule.do.forEach((toDo) => {
        if (schedule.url) {
          toDo['url'] = schedule.url
        }

        this.#runDo(toDo, i)
      })

      schedule.check.forEach((toCheck) => this.#runCheck(toCheck, i))

      this.#trigger('scheduleInit', {
        schedule,
        scheduleIndex: i,
      })
    })

    Private.isLoading = false

    return this
  }

  #runCheck(prop, index) {
    if (Private.actionables.length === index) {
      Private.actionables.push({
        toDo: [],
        toCheck: [],
      })
    }

    const obj = {
      selector: null,
      action: prop,
      params: [],
      description: `Checking "${prop.action}" on [${
        prop.action == 'isOn' || prop.action == 'isNotOn'
          ? prop.params[0]
          : prop.selector
      }]`,
      ...prop,
    }

    Private.actionables[index].toCheck.push(obj)

    return this
  }

  #runDo(prop, index) {
    const obj = {
      selector: null,
      action: prop,
      params: [],
      description: null,
      ...prop,
    }

    if (Private.actionables.length === index) {
      Private.actionables.push({
        toDo: [],
        toCheck: [],
      })
    }

    Private.actionables[index].toDo.push(obj)

    return this
  }

  #scheduleIsEmpty() {
    return (
      !Private.actionables[Private.currentSchedule] ||
      (!Private.actionables[Private.currentSchedule].toDo.length &&
        !Private.actionables[Private.currentSchedule].toCheck.length)
    )
  }

  #startWorking() {
    if (Private.isWorking) {
      return this
    }

    this.#trigger('actionStart', {
      scheduleIndex: Private.currentSchedule,
      actionIndex: Private.currentIndex,
      action: Private.currentAction,
      on: Private.current,
    })

    Private.isWorking = true

    return this
  }

  #stopWorking() {
    Private.isWorking = false

    return this
  }

  #success() {
    try {
      this.#stopWorking()

      // save to result
      if (Private.results.length <= Private.currentSchedule) {
        Private.results.push({
          title: Private.schedules[Private.currentSchedule].title,
          list: [],
          passed: 0,
          failed: 0,
        })
      }

      Private.results[Private.currentSchedule]['passed']++
      Private.results[Private.currentSchedule]['list'].push({
        action: Private.currentAction,
        index: this.currentIndex,
        description: Private.current.description,
        is_success: true,
      })

      // trigger success

      this.#trigger('actionSuccess', {
        scheduleIndex: Private.currentSchedule,
        actionIndex: Private.currentIndex,
        action: Private.currentAction,
        on: Private.current,
      })
    } catch (e) {}

    return this
  }

  #trigger(event, detail) {
    try {
      let schedule

      if (detail.schedule) {
        schedule = detail.schedule
        delete detail.schedule
      } else if (detail.scheduleIndex) {
        schedule = Private.schedules[detail.scheduleIndex]
      } else if (Private.currentSchedule > -1) {
        schedule = Private.schedules[Private.currentSchedule]
      }

      Private.events[event]({
        name: event,
        schedule,
        detail,
      })
    } catch (e) {}

    return this
  }

  #verify(action, status) {
    try {
      if (action.toLowerCase().indexOf('not') !== -1) {
        // must not be true
        if (status === Private.STATUS_SUCCESS) {
          this.#fail()
        } else {
          this.#success()
        }
      } else {
        // must be true
        if (status === Private.STATUS_SUCCESS) {
          this.#success()
        } else {
          this.#fail()
        }
      }
    } catch (e) {
      this.#fail(e.message)
    }

    Private.isReady = true

    if (Private.config.autoAdvance) {
      this.#checkNext()
    } else {
      if (this.#scheduleIsEmpty()) {
        this.#finishSchedule()
      } else {
        this.pause()
      }
    }

    return this
  }

  #waiting(status) {
    Private.isWaiting = status !== undefined ? status : true

    return this
  }
}
