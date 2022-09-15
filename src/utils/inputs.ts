import * as core from '@actions/core'

export function getInput(key: string): string {
  return String(_getInput(key));
}

export function getInputBoolean(key: string): boolean {
  return _getInput(key).toString().toLowerCase() === "true";
}

export function getInputNumber(key: string): number | undefined {
  try {
    const value = Number(_getInput(key));
    if (isNaN(value)) {
      return undefined;
    } else {
      return value;
    }
  } catch (e) {
    return undefined;
  }
}

function _getInput(key: string): any {

  return core.getInput(key) || process.env[key];

}
