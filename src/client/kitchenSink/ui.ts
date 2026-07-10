// Small vanilla-DOM helpers shared by every kitchen-sink category. No framework -
// this is plain HTML/CSS/TS to keep the example dependency-free and easy to read.

import { showToast } from '@devvit/web/client';
import { traceClientLog } from '../clientLogs';

export type InputSpec = {
  id: string;
  label: string;
  type?: 'text' | 'number';
  defaultValue?: string;
};

/** Reads the current value of the input registered with the given `id`, or `''` if
 * that id has no matching input (a function, rather than a plain object, sidesteps
 * `noUncheckedIndexedAccess` turning every lookup into `string | undefined`). */
export type GetInputValue = (id: string) => string;

export type ExampleRowOptions = {
  title: string;
  description: string;
  buttonLabel?: string;
  inputs?: InputSpec[];
  /** Return value is JSON.stringify'd into the output panel; strings are shown as-is. */
  run: (values: GetInputValue, event: MouseEvent) => Promise<unknown> | unknown;
};

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};

const formatOutput = (value: unknown): string => {
  if (value === undefined) return '(no return value)';
  if (typeof value === 'string') return value;
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === 'bigint' ? v.toString() : v),
    2
  );
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Builds one "card" for a single example: title, description, optional inputs, a
 * run button, and a panel that shows the JSON result (or error) of running it. */
export const exampleRow = (opts: ExampleRowOptions): HTMLElement => {
  const row = el('div', 'ks-row');

  const info = el('div', 'ks-row-info');
  const title = el('h3', 'ks-row-title');
  title.textContent = opts.title;
  const description = el('p', 'ks-row-description');
  description.textContent = opts.description;
  info.append(title, description);

  const inputEls: Record<string, HTMLInputElement> = {};
  let inputsContainer: HTMLElement | undefined;
  if (opts.inputs?.length) {
    inputsContainer = el('div', 'ks-row-inputs');
    for (const spec of opts.inputs) {
      const field = el('label', 'ks-row-field');
      const labelText = el('span', 'ks-row-field-label');
      labelText.textContent = spec.label;
      const input = document.createElement('input');
      input.type = spec.type ?? 'text';
      input.value = spec.defaultValue ?? '';
      input.name = spec.id;
      inputEls[spec.id] = input;
      field.append(labelText, input);
      inputsContainer.append(field);
    }
  }

  const controls = el('div', 'ks-row-controls');
  const button = el('button', 'ks-button');
  button.textContent = opts.buttonLabel ?? 'Run';
  const output = el('pre', 'ks-output');
  output.textContent = '(not run yet)';
  controls.append(button, output);

  const getValue: GetInputValue = (id) => inputEls[id]?.value ?? '';

  button.addEventListener('click', (event) => {
    void (async () => {
      button.disabled = true;
      output.classList.remove('ks-output-error');
      output.textContent = 'Running…';
      traceClientLog('Starting client action:', opts.title);
      try {
        const result = await opts.run(getValue, event);
        output.textContent = formatOutput(result);
        console.info('Completed client action:', opts.title);
      } catch (error) {
        const message = errorMessage(error);
        output.classList.add('ks-output-error');
        output.textContent = `Error: ${message}`;
        console.error('Client action failed:', opts.title, error);
        showToast(`Error: ${message}`);
      } finally {
        button.disabled = false;
      }
    })();
  });

  row.append(info);
  if (inputsContainer) row.append(inputsContainer);
  row.append(controls);
  return row;
};

export const sectionHeading = (text: string): HTMLElement => {
  const heading = el('h2', 'ks-section-heading');
  heading.textContent = text;
  return heading;
};

export const paragraph = (text: string): HTMLElement => {
  const p = el('p', 'ks-section-intro');
  p.textContent = text;
  return p;
};
