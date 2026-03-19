import { Buffer } from 'buffer'
import process from 'process'

if (typeof window !== 'undefined') {
    window.Buffer = Buffer
    window.process = process
    // @ts-ignore
    window.global = window
}
