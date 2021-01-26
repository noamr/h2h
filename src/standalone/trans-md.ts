import MarkdownIt from 'markdown-it'

customElements.define('trans-md', class TransMD extends HTMLElement {
    constructor() {
        super()
        const slot = this.ownerDocument.createElement('slot')
        const shadow = this.attachShadow({mode: 'closed'})
        shadow.addEventListener('slotchange', () => this.render())
        shadow.appendChild(slot)
    }

    get observedAttributes() { return ['src'] }

    async attributesChangedCallback() {
        this.render()
    }

    async render() {
        const inline = this.firstChild ? (this.firstChild as Text).textContent : null
        if (!this.hasAttribute('src') && !inline)
            return
        const markdown = inline || await (await fetch(this.getAttribute('src') as string)).text()
        const rendered = new MarkdownIt().render(markdown)
        this.outerHTML = rendered
    }

    connectedCallback() {
        this.render()
    }
})