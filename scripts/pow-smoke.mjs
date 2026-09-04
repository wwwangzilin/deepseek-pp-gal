import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE = {
  challenge: 'cebab4aa8e50955666f589816c66811144e056a8f41c43a43bd78cedc4b5f4a1',
  salt: '8360f8c9205c96c32b7a',
  expireAt: 1739764288699,
  difficulty: 144000,
  answer: 77906,
};

const wasmPath = resolve('public/deepseek/sha3_wasm_bg.wasm');
const wasmBytes = readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(wasmBytes, {});
const wasm = instance.exports;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const prefix = `${FIXTURE.salt}_${FIXTURE.expireAt}_`;
const digest = hashWithWasm(`${prefix}${FIXTURE.answer}`);
if (digest !== FIXTURE.challenge) {
  throw new Error(`DeepSeek PoW digest fixture failed: ${digest}`);
}

const answer = solveWithWasm(FIXTURE.challenge, prefix, FIXTURE.difficulty);
if (answer !== FIXTURE.answer) {
  throw new Error(`DeepSeek PoW solve fixture failed: ${answer}`);
}

console.log(`DeepSeek PoW smoke passed: answer=${answer}`);

function solveWithWasm(challenge, saltExpirePrefix, difficulty) {
  const retPtr = wasm.__wbindgen_add_to_stack_pointer(-16);
  const challengeAllocation = writeWasmString(challenge);
  const prefixAllocation = writeWasmString(saltExpirePrefix);

  try {
    wasm.wasm_solve(
      retPtr,
      challengeAllocation.ptr,
      challengeAllocation.len,
      prefixAllocation.ptr,
      prefixAllocation.len,
      difficulty,
    );

    const view = new DataView(wasm.memory.buffer);
    const status = view.getInt32(retPtr, true);
    const answer = view.getFloat64(retPtr + 8, true);
    if (status !== 1 || !Number.isSafeInteger(answer)) return null;
    return answer;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

function hashWithWasm(value) {
  const retPtr = wasm.__wbindgen_add_to_stack_pointer(-16);
  const allocation = writeWasmString(value);

  try {
    wasm.wasm_deepseek_hash_v1(retPtr, allocation.ptr, allocation.len);
    const view = new DataView(wasm.memory.buffer);
    const ptr = view.getInt32(retPtr, true);
    const len = view.getInt32(retPtr + 4, true);
    return decoder.decode(new Uint8Array(wasm.memory.buffer, ptr, len));
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

function writeWasmString(value) {
  const bytes = encoder.encode(value);
  const ptr = wasm.__wbindgen_export_0(bytes.length, 1);
  new Uint8Array(wasm.memory.buffer).set(bytes, ptr);
  return { ptr, len: bytes.length };
}
