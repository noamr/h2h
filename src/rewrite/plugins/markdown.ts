import {JSDOM} from 'jsdom'
import MarkdownIt from 'markdown-it'

export default async function executeMarkdown({window}: JSDOM) {
    const markdowns = window.document.querySelectorAll('zero-md')
    const markd = new MarkdownIt()
    let needsClientSide = false
    markdowns.forEach(md => {
        const script = md.querySelector("script[type='text/markdown']")
        if (!script)
            return

        const html = markd.render(script.innerHTML)
        md.outerHTML = html
    })
}
