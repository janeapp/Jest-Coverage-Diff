/* eslint-disable no-console */
import * as core from '@actions/core'
import * as github from '@actions/github'
import {exec, execSync} from 'child_process'
import fs from 'fs'
import {CoverageReport} from './Model/CoverageReport'
import {DiffChecker} from './DiffChecker'

const safeExec = (cmd: string): void => {
  execSync(cmd)
}

const getComment = (diffChecker: DiffChecker): string => {
  const currentDirectory = execSync('pwd')
    .toString()
    .trim()

  let messageToPost = `## :x: Test coverage decrease
Code coverage diff between base branch:\`${branchNameBase}\` and head branch: \`${branchNameHead}\`
Current PR reduces the test coverage percentage \n\n`
  const coverageDetails = diffChecker.getCoverageDetails(
    !fullCoverage,
    `${currentDirectory}/`
  )
  if (coverageDetails.length !== 0) {
    messageToPost +=
      'Status | File | % Stmts | % Branch | % Funcs | % Lines \n -----|-----|---------|----------|---------|------ \n'
    messageToPost += coverageDetails.join('\n')
  }
  return messageToPost
}

const checkHasLabel = async (): Promise<boolean> => {
  console.log(`Checking if coverage has gone down by more than ${delta}%`)
  const labels = await githubClient.issues.listLabelsOnIssue(clientParams)
  return labels.data.map(l => l.name).includes(coverageLabel)
}

const notifyCoverageUp = async (): Promise<void> => {
  console.log('Commenting and removing label.')

  await githubClient.issues.createComment({
    ...clientParams,
    body: `## :white_check_mark: Test coverage decrease undone`
  })
  await githubClient.issues.removeLabel({
    ...clientParams,
    name: coverageLabel
  })
}

const notifyCoverageDown = async (comment: string): Promise<void> => {
  console.log('Creating comment and adding label.')
  console.log(`Message to post:`)
  console.log(comment)
  console.log(`End of message to post`)

  await githubClient.issues.createComment({
    ...clientParams,
    body: comment
  })
  await githubClient.issues.addLabels({
    ...clientParams,
    labels: [coverageLabel]
  })
}

const coverageLabel = 'jest-coverage-down'
const repoName = github.context.repo.repo
const repoOwner = github.context.repo.owner
const githubToken = core.getInput('accessToken')
const fullCoverage = JSON.parse(core.getInput('fullCoverageDiff'))
// const commandToRun = core.getInput('runCommand')
// const commandAfterSwitch = core.getInput('afterSwitchCommand')
const delta = Number(core.getInput('delta'))
const githubClient = github.getOctokit(githubToken)
const prNumber = github.context.issue.number
const branchNameBase = github.context.payload.pull_request?.base.ref
const branchNameHead = github.context.payload.pull_request?.head.ref
const clientParams = {
  repo: repoName,
  owner: repoOwner,
  // eslint-disable-next-line @typescript-eslint/camelcase
  issue_number: prNumber
}

async function run(): Promise<void> {
  try {
    safeExec('/usr/bin/git fetch --no-tags --depth=1 origin master')
    safeExec(`/usr/bin/git checkout -b ${branchNameBase}`)
    safeExec(`/usr/bin/git checkout ${branchNameHead}`)

    const commandToRunOnHead = `npx jest --ci --runInBand --coverage --changedSince=master --collectCoverage=true --coverageDirectory='./' --coverageReporters="json-summary"`
    console.log(`Current branch: ${branchNameHead}.`)
    console.log(commandToRunOnHead)
    safeExec(commandToRunOnHead)

    const codeCoverageNew = <CoverageReport>(
      JSON.parse(fs.readFileSync('coverage-summary.json').toString())
    )

    const relatedTests = Object.keys(codeCoverageNew).join(' ')

    const commandToRunOnBase = `npx jest --ci --runInBand --coverage --collectCoverage=true --coverageDirectory='./' --coverageReporters="json-summary" --findRelatedTests ${relatedTests}`
    console.log(commandToRunOnBase)
    safeExec(commandToRunOnBase)

    const codeCoverageOld = <CoverageReport>(
      JSON.parse(fs.readFileSync('coverage-summary.json').toString())
    )

    const diffChecker: DiffChecker = new DiffChecker(
      codeCoverageNew,
      codeCoverageOld
    )

    const comment = getComment(diffChecker)
    const coverageDown = diffChecker.checkIfTestCoverageFallsBelowDelta(delta)
    const hasLabel = await checkHasLabel()

    if (coverageDown && hasLabel) {
      console.log('Coverage Down.')
      console.log(`PR already has ${coverageLabel} tag. Doing nothing.`)
    }

    if (coverageDown && !hasLabel) {
      console.log('Coverage Down.')
      await notifyCoverageDown(comment)
    }

    if (!coverageDown && hasLabel) {
      console.log('Coverage did not go down.')
      console.log(`Label ${coverageLabel} found.`)
      await notifyCoverageUp()
    }

    if (!coverageDown && !hasLabel) {
      console.log('Coverage did not go down.')
      console.log(`Label ${coverageLabel} not found. Doing nothing.`)
    }
  } catch (error) {
    console.log('ERROR', error)
    core.setFailed(error as Error)
  }
}

run()
