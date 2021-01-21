import {map} from 'lodash'

export function helloLodash() {
    return map([1, 2, 3], (a: number) => `${a}a`).join(' ')
}