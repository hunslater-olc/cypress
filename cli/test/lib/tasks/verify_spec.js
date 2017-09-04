require('../../spec_helper')

const _ = require('lodash')
const os = require('os')
const cp = require('child_process')
const EE = require('events').EventEmitter
const Promise = require('bluebird')
const snapshot = require('snap-shot-it')
const stripAnsi = require('strip-ansi')

const fs = require(`${lib}/fs`)
const util = require(`${lib}/util`)
const logger = require(`${lib}/logger`)
const xvfb = require(`${lib}/exec/xvfb`)
const info = require(`${lib}/tasks/info`)
const verify = require(`${lib}/tasks/verify`)

const stdout = require('../../support/stdout')

const packageVersion = '1.2.3'
const executablePath = '/path/to/executable'
const executableDir = '/path/to/executable/dir'
const installationDir = info.getInstallationDir()
// const replaceRe = /(.+REPLACER)/g

const normalize = (str) => {
  return stripAnsi(str)
  // .replace('[90m→ Cypress Version: 1.2.3[39m', '')
  // .replace(replaceRe, '')
}

context('.verify', function () {
  beforeEach(function () {
    this.stdout = stdout.capture()
    this.cpstderr = new EE()
    this.cpstdout = new EE()
    this.sandbox.stub(util, 'pkgVersion').returns(packageVersion)
    this.sandbox.stub(os, 'platform').returns('darwin')
    this.sandbox.stub(os, 'release').returns('test release')
    this.ensureEmptyInstallationDir = () => {
      return fs.removeAsync(installationDir)
      .then(() => {
        return info.ensureInstallationDir()
      })
    }
    this.spawnedProcess = _.extend(new EE(), {
      unref: this.sandbox.stub(),
      stderr: this.cpstderr,
      stdout: this.cpstdout,
    })
    this.sandbox.stub(cp, 'spawn').returns(this.spawnedProcess)
    this.sandbox.stub(info, 'getPathToExecutable').returns(executablePath)
    this.sandbox.stub(info, 'getPathToUserExecutableDir').returns(executableDir)
    this.sandbox.stub(xvfb, 'start').resolves()
    this.sandbox.stub(xvfb, 'stop').resolves()
    this.sandbox.stub(xvfb, 'isNeeded').returns(false)
    this.sandbox.stub(Promise, 'delay').resolves()
    this.sandbox.stub(this.spawnedProcess, 'on')
    this.spawnedProcess.on.withArgs('close').yieldsAsync(0)
    return this.ensureEmptyInstallationDir()
  })

  afterEach(function () {
    stdout.restore()
  })

  it('logs error and exits when no version of Cypress is installed', function () {
    const ctx = this

    return info.writeInfoFileContents({})
    .then(() => {
      return verify.start()
    })
    .then(() => {
      throw new Error('should have caught error')
    })
    .catch((err) => {
      logger.error(err)

      snapshot('no version of Cypress installed', ctx.stdout.toString())
    })
  })

  it('is noop when verifiedVersion matches expected', function () {
    const ctx = this

    // make it think the executable exists
    this.sandbox.stub(fs, 'statAsync').resolves()

    return info.writeInfoFileContents({
      version: packageVersion,
      verifiedVersion: packageVersion,
    })
    .then(() => {
      return verify.start()
    })
    .then(() => {
      // nothing should have been logged to stdout
      // since no verification took place
      expect(ctx.stdout.toString()).to.be.empty

      expect(cp.spawn).not.to.be.called
    })
  })

  it('logs warning when installed version does not match package version', function () {
    const ctx = this

    this.sandbox.stub(fs, 'statAsync')
    .callThrough()
    .withArgs(executablePath)
    .resolves()

    // force this to throw to short circuit actually running smoke test
    this.sandbox.stub(info, 'getVerifiedVersion').rejects(new Error)

    return info.writeInstalledVersion('bloop')
    .then(() => {
      return verify.start()
    })
    .then(() => {
      throw new Error('should have caught error')
    })
    .catch(() => {
      snapshot(
        'warning installed version does not match package version', ctx.stdout.toString()
      )
    })
  })

  it('logs error and exits when executable cannot be found', function () {
    const ctx = this

    return info.writeInstalledVersion(packageVersion)
    .then(() => {
      return verify.start()
    })
    .then(() => {
      throw new Error('should have caught error')
    })
    .catch((err) => {
      logger.error(err)

      snapshot('executable cannot be found', ctx.stdout.toString())
    })
  })

  describe('with force: true', function () {
    beforeEach(function () {
      this.sandbox.stub(fs, 'statAsync').resolves()
      this.sandbox.stub(_, 'random').returns('222')
      this.sandbox.stub(this.cpstdout, 'on').yieldsAsync('222')

      return info.writeInfoFileContents({
        version: packageVersion,
        verifiedVersion: packageVersion,
      })
    })

    it('shows full path to executable when verifying', function () {
      const ctx = this

      return verify.start({ force: true })
      .then(() => {
        expect(cp.spawn).to.be.calledWith(executablePath, [
          '--smoke-test',
          '--ping=222',
        ])
      })
      .then(() => {
        return info.getVerifiedVersion()
      })
      .then((vv) => {
        expect(vv).to.eq(packageVersion)
      })
      .then(() => {
        snapshot('verification with executable', ctx.stdout.toString())
      })
    })

    it('clears verified version from state if verification fails', function () {
      const ctx = this

      const stderr = 'an error about dependencies'

      this.sandbox.stub(this.cpstderr, 'on').withArgs('data').yields(stderr)

      this.spawnedProcess.on.withArgs('close').yieldsAsync(1)

      return verify.start({ force: true })
      .catch((err) => {
        logger.error(err)

        snapshot('fails verifying Cypress', normalize(ctx.stdout.toString()))

        return info.getVerifiedVersion()
      })
      .then((verifiedVersion) => {
        expect(verifiedVersion).to.be.null
      })
    })
  })

  describe('smoke test', function () {
    beforeEach(function () {
      this.sandbox.stub(fs, 'statAsync').resolves()
      this.sandbox.stub(_, 'random').returns('222')
      this.sandbox.stub(this.cpstdout, 'on').yieldsAsync('222')
    })

    it('logs and runs when no version has been verified', function () {
      const ctx = this

      return info.writeInfoFileContents({
        version: packageVersion,
      })
      .then(() => {
        return verify.start()
      })
      .then(() => {
        return info.getVerifiedVersion()
      })
      .then((vv) => {
        expect(vv).to.eq(packageVersion)
      })
      .then(() => {
        snapshot('no existing version verified', ctx.stdout.toString())
      })
    })

    it('logs and runs when current version has not been verified', function () {
      const ctx = this

      return info.writeInfoFileContents({
        version: packageVersion,
        verifiedVersion: 'different version',
      })
      .then(() => {
        return verify.start()
      })
      .then(() => {
        return info.getVerifiedVersion()
      })
      .then((vv) => {
        expect(vv).to.eq(packageVersion)
      })
      .then(() => {
        snapshot('current version has not been verified', ctx.stdout.toString())
      })
    })

    describe('on linux', function () {
      beforeEach(function () {
        xvfb.isNeeded.returns(true)

        return info.writeInfoFileContents({
          version: packageVersion,
          verifiedVersion: 'different version',
        })
      })

      it('starts xvfb', function () {
        return verify.start()
        .then(() => {
          expect(xvfb.start).to.be.called
        })
      })

      it('stops xvfb on spawned process close', function () {
        this.spawnedProcess.on.withArgs('close').yieldsAsync(0)
        return verify.start()
        .then(() => {
          expect(xvfb.stop).to.be.called
        })
      })

      it('logs error and exits when starting xvfb fails', function () {
        const ctx = this

        const err = new Error('test without xvfb')
        err.stack = 'xvfb? no dice'
        xvfb.start.rejects(err)
        return verify.start()
        .catch((err) => {
          expect(xvfb.stop).to.be.calledOnce

          return Promise.delay(1000)
          .then(() => {
            logger.error(err)

            snapshot('xvfb fails', normalize(ctx.stdout.toString()))
          })
        })
      })
    })
  })
})
