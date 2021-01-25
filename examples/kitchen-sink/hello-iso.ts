import {helloLodash} from "./hello-lodash.ts"
import {hello} from "./hello-world.ts"

const output = document.querySelector('#iso-output') as HTMLElement
output.innerText = `
    ${output.innerText}
    ${hello()} ${helloLodash()}
`
