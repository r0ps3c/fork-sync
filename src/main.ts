import * as core from '@actions/core'
import * as github from '@actions/github'
import {Octokit} from '@octokit/rest'
import {retry} from '@octokit/plugin-retry'
const token = core.getInput('token', {required: true})
const MyOctokit = Octokit.plugin(retry)

async function run() {
  let owner =
    core.getInput('owner', {required: false}) || github.context.repo.owner
  let repo = github.context.repo.repo
  const base = core.getInput('base', {required: false})
  const head = core.getInput('head', {required: false})
  const mergeMethod = core.getInput('merge_method', {required: false})
  const prTitle = core.getInput('pr_title', {required: false})
  const prMessage = core.getInput('pr_message', {required: false})
  const ignoreFail = core.getBooleanInput('ignore_fail', {required: false})
  const autoApprove = core.getBooleanInput('auto_approve', {required: false})
  const autoMerge = core.getBooleanInput('auto_merge', {required: false})
  const retries = parseInt(core.getInput('retries', {required: false})) || 4
  const retryAfter =
    parseInt(core.getInput('retry_after', {required: false})) || 60

  const octokit = new MyOctokit({
    auth: token,
    request: {
      retries,
      retryAfter
    }
  })

  const r = await octokit.rest.repos.get({
    owner,
    repo
  })

  if (r && r.data && r.data.parent) {
    owner = r.data.parent.owner.login || owner
    repo = r.data.parent.name || repo
  }

  try {
    const pr = await octokit.pulls.create({
      owner: github.context.repo.owner,
      repo,
      title: prTitle,
      head: `${owner}:${head}`,
      base,
      body: prMessage,
      maintainer_can_modify: false
    })
    await delay(20)
    if (autoApprove) {
      await octokit.pulls.createReview({
        owner: github.context.repo.owner,
        repo,
        pull_number: pr.data.number,
        event: 'COMMENT',
        body: 'Auto approved'
      })
      await octokit.pulls.createReview({
        owner: github.context.repo.owner,
        repo,
        pull_number: pr.data.number,
        event: 'APPROVE'
      })
    }
    if (autoMerge) {
      await octokit.pulls.merge({
        owner: github.context.repo.owner,
        repo,
        pull_number: pr.data.number,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        merge_method: mergeMethod
      })
    }
    //eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error.request.request.retryCount) {
      core.error(
        `request failed after ${error.request.request.retryCount} retries with a delay of ${error.request.request.retryAfter}`
      )
    }
    if (
      !!error.errors &&
      !!error.errors[0] &&
      !!error.errors[0].message &&
      error.errors[0].message.startsWith('No commits between')
    ) {
      core.error(
        `No commits between ${github.context.repo.owner}:${base} and ${owner}:${head}`
      )
    } else if (
      !!error.errors &&
      !!error.errors[0] &&
      !!error.errors[0].message &&
      error.errors[0].message.startsWith('A pull request already exists for')
    ) {
      // we were already done
      core.warning(String(error.errors[0].message))
    } else {
      if (!ignoreFail) {
        core.setFailed(
          `Failed to create or merge pull request: ${error ?? '[n/a]'}`
        )
      }
    }
  }
}

function delay(s: number) {
  return new Promise(resolve => setTimeout(resolve, s * 1000))
}

//eslint-disable-next-line @typescript-eslint/no-floating-promises
run()
