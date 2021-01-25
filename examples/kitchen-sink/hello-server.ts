import {helloLodash} from "./hello-lodash.ts"
import {hello} from "./hello-world.ts"

console.log('!!!')
window.document.querySelector('#server-output').innerHTML = `${hello()} ${helloLodash()}`
