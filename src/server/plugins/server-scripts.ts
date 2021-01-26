import {JSDOM} from 'jsdom'
import path from 'path'
import {readFile, writeFile} from 'fs-extra'
import {runInNewContext} from 'vm'
import {launch} from 'puppeteer'
import express from 'express'
import getPort from 'get-port'
import {v4} from 'uuid'

export default async function executeServerScripts({window}: JSDOM, basePath: string): Promise<string> {
    const scriptAttributes = ['src', 'defer', 'async', 'server-side']
    const serverScripts = Array.from(window.document.querySelectorAll('script'))
    for (const script of serverScripts) {
        const newScript = window.document.createElement('maybe-script')
        for (const attribName of scriptAttributes.filter(a => script.hasAttribute(a)))
            newScript.setAttribute(attribName, script.getAttribute(attribName) || '')

        newScript.innerHTML = script.innerHTML
        script.insertAdjacentElement('afterend', newScript)
        script.remove()
    }

    const browser = await launch({})
    const page = await browser.newPage()
    const port = await getPort()
    const app = express()
    app.use(express.static(basePath))
    const modifiedHTML = `${v4()}.html`
    await writeFile(path.join(basePath, modifiedHTML), window.document.documentElement.outerHTML)

    await new Promise(r => app.listen(port, () => r({})))
    await page.evaluateOnNewDocument(() => {
        window.customElements.define('maybe-script', class MaybeScript extends HTMLElement {
            rendered = false
            shadow: any

            constructor() {
                super()
                this.shadow = this.attachShadow({mode: 'closed'})
                const style = window.document.createElement('style')
                style.innerHTML = `:host {display: none}`
                const slot = window.document.createElement('slot')
                slot.addEventListener('slotchange', () => this.render())
            }

            async render() {
                if (this.getAttribute('server-side') !== 'server-side')
                    return

                if (this.rendered)
                    return

                const src = this.getAttribute('src')
                const inline = this.innerHTML

                if (!src && !inline)
                    return

                const newScript = window.document.createElement('script') as HTMLScriptElement
                this.rendered = true
                if (src)
                    newScript.src = src
                else
                    newScript.innerHTML = inline
                
                newScript.src = this.getAttribute('src') || ''
                newScript.defer = this.hasAttribute('defer')
                newScript.async = true
                this.shadow.appendChild(newScript)
            }
            
            connectedCallback() {
                this.render()
            }
        })
    })

    await page.goto(`http://localhost:${port}/${modifiedHTML}`, {waitUntil: 'load'})
    await page.setJavaScriptEnabled(false)
    await page.evaluate(() => {
        const scripts = window.document.querySelectorAll('maybe-script')
        for (const script of Array.from(scripts)) {
            const side = script.getAttribute('server-side')
            if (side === 'server-side') {
                script.remove()
                continue
            }
            const newScript = window.document.createElement('script')
            for (const attribName of ['src', 'defer', 'async'].filter(a => script.hasAttribute(a)))
                newScript.setAttribute(attribName, script.getAttribute(attribName) || '')

            newScript.innerHTML = script.innerHTML
            script.replaceWith(newScript)
        }
    })

    return await page.content()
}
