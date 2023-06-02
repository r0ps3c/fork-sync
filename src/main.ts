const Octokit = import('@octokit/rest')
const Github = import('@actions/github')
const core = import('@actions/core')
const retry = import('@octokit/plugin-retry')

async function run() {
  const context = (await Github).context
  let owner =
    (await core).getInput('owner', {required: false}) || context.repo.owner
  let repo =
    (await core).getInput('repo', {required: false}) || context.repo.repo
  const base = (await core).getInput('base', {required: false})
  const head = (await core).getInput('head', {required: false})
  const mergeMethod = (await core).getInput('merge_method', {required: false})
  const prTitle = (await core).getInput('pr_title', {required: false})
  const prMessage = (await core).getInput('pr_message', {required: false})
  const ignoreFail = (await core).getBooleanInput('ignore_fail', {
    required: false
  })
  const autoApprove = (await core).getBooleanInput('auto_approve', {
    required: false
  })
  const autoMerge = (await core).getBooleanInput('auto_merge', {
    required: false
  })
  const numRetries =
    parseInt((await core).getInput('retries', {required: false})) ?? 3
  const retrySeconds =
    parseInt((await core).getInput('retry_after', {required: false})) ?? 30
  const token = (await core).getInput('token', {required: true})

  const MyOctokit = (await Octokit).Octokit.plugin((await retry).retry)
  const octokit = new MyOctokit({
    auth: token,
    request: {retries: numRetries, retryAfter: retrySeconds}
  })

  const r = octokit.repos.get({
    owner,
    repo
  })

  if ((await r)?.data?.parent) {
    owner = (await r).data.parent?.owner.login ?? owner
    repo = (await r).data.parent?.name || repo
  }

  try {
    ;(await core).debug(
      `about to compare ${owner}:${base}...${context.repo.owner}:${head}`
    )

    const cmpres = await octokit.repos.compareCommitsWithBasehead({
      owner: context.repo.owner,
      repo: context.repo.repo,
      basehead: `${owner}:${base}...${context.repo.owner}:${head}`
    })

    if (cmpres.data.behind_by === 0) {
      ;(await core).info('Fork is up to date, exiting')
      return
    }

    ;(await core).debug('creating PR')
    const pr = await octokit.pulls.create({
      owner: context.repo.owner,
      repo: context.repo.repo,
      title: prTitle,
      head: `${owner}:${head}`,
      base,
      body: prMessage,
      maintainer_can_modify: false
    })
    ;(await core).info(`created PR #${pr.data.number}`)

    if (autoApprove) {
      ;(await core).debug('creating and auto approving review')
      await octokit.pulls.createReview({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pr.data.number,
        event: 'COMMENT',
        body: 'Auto approved'
      })
      await octokit.pulls.createReview({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pr.data.number,
        event: 'APPROVE'
      })
      ;(await core).info(`approved PR #${pr.data.number}`)
    }

    if (autoMerge) {
      ;(await core).debug('auto merging')
      await octokit.pulls.merge({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pr.data.number,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        merge_method: mergeMethod
      })
      ;(await core).info(`approved PR #${pr.data.number}`)
    }
    //eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error?.request?.request?.retryCount) {
      ;(await core).info(
        `request failed after ${
          error.request.request.retryCount
        } retries with a delay of ${
          error.request.request.retryAfter
        }, with error ${(error?.errors ?? error?.response?.data)?.message}`
      )
      if (error?.errors)
        (await core).debug(`errors=${JSON.stringify(error.errors)}`)
      if (error?.response?.data?.errors)
        (await core).debug(`response=${JSON.stringify(error.response)}`)
    } else if (
      (error?.errors ?? error?.response?.data)?.message?.startsWith(
        'No commits between'
      )
    )
      (await core).info(
        `No commits between ${owner}:${base}...${context.repo.owner}:${head}`
      )
    else if (
      (error?.errors ?? error?.response?.data)?.message?.startsWith(
        'A pull request already exists for'
      )
    )
      (await core).info(
        String(
          (error?.errors ?? error?.response?.data)?.message ??
            'Unknown error creating merge/pull'
        )
      )
    else if (!ignoreFail)
      (await core).setFailed(
        `Failed to create or merge pull request: ${error ?? '[n/a]'}`
      )
  }
}

//eslint-disable-next-line @typescript-eslint/no-floating-promises
run()
