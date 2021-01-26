import fs from 'fs-extra'
import path from 'path'
import express from 'express'
import {buildIfNeeded} from './rewrite'
import {executeHTML} from './execute'
import chokidar from 'chokidar'
import {tmpdir} from 'os'
import http from 'http'
import unzipper from 'unzipper'

export interface ServeOptions {
    sourceType: 'file' | 'github'
}
export interface FileServeOptions extends ServeOptions{
    sourceType: 'file'
    source: string
}
export interface GithubServeOptions extends ServeOptions{
    sourceType: 'github'
    source: {
        repo: string
        branch: string
        path: string
    }
}

function browserFromRequest(req: express.Request, defaultBrowser = 'chrome80') {
    const userAgent = req.header('user-agent') || ''
    const safariVersion = /\/(\d+).\d+.\d+ Safari\//.exec(userAgent)
    const chromeVersion = / Chrome\/(\d+)/.exec(userAgent)
    const firefoxVersion = / Firefox\/(\d+)/.exec(userAgent)
    return safariVersion ? `safari${safariVersion[1]}` :
            chromeVersion ? `chrome${chromeVersion[1]}` :
            firefoxVersion ? `firefox${firefoxVersion[1]}` :
            defaultBrowser
}

const repoRoot = path.join(tmpdir(), 'transp')

async function extractFromGithub(options: {repo: string, branch: string, path: string}) {
    const {repo, branch} = options
    const branchInfo = await (await fetch(`https://api.github.com/repos/${repo}/branches/${branch}`)).json()
    const sha = branchInfo.commit.sha
    const gitDir = path.join(repoRoot, sha)
    if (fs.existsSync(gitDir))
        return gitDir

    const zipURL = `https://api.github.com/${repo}/archive/${sha}.zip`
    await new Promise((resolve, reject) =>
        http.get(zipURL, res => res.pipe(
            unzipper.Extract({path: gitDir})
                .on('finish', resolve)
                .on('error', reject))))

    return path.join(gitDir, options.path)
}

export function serve(options: ServeOptions) {
    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const browser = browserFromRequest(req)
        let rootDir = ''
        let watch = false
        switch (options.sourceType) {
            case 'file':
                rootDir = path.normalize((options as FileServeOptions).source)
                watch = true
                break
            case 'github':
                rootDir = await extractFromGithub((options as GithubServeOptions).source)
                break
        }

        const dir = await buildIfNeeded({rootDir, watch, repoRoot, browser})
        if ((req.headers['accept'] || '').includes('text/html')) {
            const html = await fs.readFile(path.join(dir, req.path || 'index.html'), 'utf8')
            if (html) {
                const rewritten = await executeHTML(html, dir)
                res.setHeader('Content-type', 'text/html')
                res.send((await executeHTML(html, dir)).html)
                return
            }
        }
        express.static(dir)(req, res, next)
    }
}