import { buildId } from '../../shared/buildInfo';
import { trpc } from '../trpc';
import { el, errorMessage, paragraph, sectionHeading } from './ui';

type AgentCommand = {
  id: string;
  category: string;
  description: string;
  browserSteps: string[];
};

const format = (value: unknown) => JSON.stringify(value, null, 2);

export const buildAgentConsole = (container: HTMLElement) => {
  const expectedLabel = el('label', 'ks-row-field');
  const expectedText = el('span', 'ks-row-field-label');
  expectedText.textContent = 'Expected build ID (optional terminal check)';
  const expected = document.createElement('input');
  expected.dataset.testid = 'agent-expected-build-id';
  expected.placeholder = 'Run npm run agent:build-id';
  expectedLabel.append(expectedText, expected);

  const readiness = el('p', 'ks-status');
  readiness.dataset.testid = 'agent-readiness';
  readiness.textContent = `Checking client ${buildId} against the deployed server…`;
  const fixture = el('p', 'ks-status');
  fixture.dataset.testid = 'agent-fixture-status';
  fixture.textContent =
    'Checking whether this is the registered agent fixture…';
  let readinessRequest = 0;

  const refreshReadiness = async () => {
    const request = ++readinessRequest;
    const expectedBuildId = expected.value.trim() || buildId;
    const result = await trpc.agent.readiness.query({
      expectedBuildId,
    });
    const clientMatches = expectedBuildId === buildId;
    const inputUnchanged =
      (expected.value.trim() || buildId) === expectedBuildId;
    const ready = clientMatches && result.ready && inputUnchanged;
    if (request !== readinessRequest) return false;
    readiness.classList.toggle('ks-output-error', !ready);
    readiness.textContent = ready
      ? `READY · client ${buildId} · server ${result.serverBuildId}`
      : `STALE · expected ${result.expectedBuildId} · client ${buildId} · server ${result.serverBuildId}`;
    return ready;
  };

  const refreshFixture = async () => {
    const result = await trpc.agent.getFixture.query();
    fixture.classList.toggle('ks-output-error', !result.isCurrentFixture);
    fixture.textContent = result.isCurrentFixture
      ? 'FIXTURE READY · this post is registered as the agent fixture'
      : result.postId
        ? `FIXTURE REQUIRED · open the registered fixture post ${result.postId}`
        : 'FIXTURE REQUIRED · use the Ensure agent fixture subreddit menu action';
  };

  const commands = document.createElement('select');
  commands.dataset.testid = 'agent-command-select';
  const commandDescription = el('p', 'ks-row-description');
  const browserSteps = el('ol', 'ks-agent-browser-steps');
  const output = el('pre', 'ks-output');
  output.dataset.testid = 'agent-command-result';
  output.textContent = '(start a run, then execute a command)';

  const start = el('button', 'ks-button');
  start.dataset.testid = 'agent-run-start';
  start.textContent = 'Start run';
  const run = el('button', 'ks-button');
  run.dataset.testid = 'agent-command-run';
  run.textContent = 'Run command';
  const finishPassed = el('button', 'ks-button');
  finishPassed.dataset.testid = 'agent-run-finish-passed';
  finishPassed.textContent = 'Finish passed';
  const finishFailed = el('button', 'ks-button');
  finishFailed.dataset.testid = 'agent-run-finish-failed';
  finishFailed.textContent = 'Finish failed';
  const reset = el('button', 'ks-button');
  reset.dataset.testid = 'agent-run-reset';
  reset.textContent = 'Reset retained state';
  const controls = el('div', 'ks-row-controls');
  controls.append(start, run, finishPassed, finishFailed, reset);

  let runId: string | undefined;
  let loadedCommands: AgentCommand[] = [];

  const selectedCommand = () =>
    loadedCommands.find((command) => command.id === commands.value);

  const renderSelectedCommand = () => {
    const command = selectedCommand();
    commandDescription.textContent = command
      ? `${command.category}: ${command.description}`
      : 'No command selected.';
    browserSteps.innerHTML = '';
    for (const step of command?.browserSteps ?? []) {
      const item = document.createElement('li');
      item.textContent = step;
      browserSteps.append(item);
    }
  };

  const setBusy = (busy: boolean) => {
    start.disabled = busy;
    run.disabled = busy;
    finishPassed.disabled = busy;
    finishFailed.disabled = busy;
    reset.disabled = busy;
  };

  expected.addEventListener('change', () => {
    void refreshReadiness().catch((error: unknown) => {
      readiness.classList.add('ks-output-error');
      readiness.textContent = `Readiness error: ${errorMessage(error)}`;
    });
  });
  commands.addEventListener('change', renderSelectedCommand);

  start.addEventListener('click', () => {
    void (async () => {
      setBusy(true);
      try {
        const ready = await refreshReadiness();
        await refreshFixture();
        if (!ready) throw new Error('Build freshness is not ready.');
        const result = await trpc.agent.startRun.mutate();
        runId = result.runId;
        output.textContent = format(result);
      } catch (error) {
        output.classList.add('ks-output-error');
        output.textContent = `Error: ${errorMessage(error)}`;
      } finally {
        setBusy(false);
      }
    })();
  });

  run.addEventListener('click', () => {
    void (async () => {
      if (!runId) {
        output.classList.add('ks-output-error');
        output.textContent = 'Start a run first.';
        return;
      }
      setBusy(true);
      try {
        const result = await trpc.agent.runCommand.mutate({
          runId,
          commandId: commands.value,
          input: {},
        });
        output.classList.remove('ks-output-error');
        output.textContent = format(result);
      } catch (error) {
        output.classList.add('ks-output-error');
        output.textContent = `Error: ${errorMessage(error)}`;
      } finally {
        setBusy(false);
      }
    })();
  });

  const finishRun = (passed: boolean) => {
    void (async () => {
      if (!runId) return;
      setBusy(true);
      try {
        const result = await trpc.agent.finishRun.mutate({
          runId,
          passed,
        });
        output.classList.toggle('ks-output-error', result.status === 'failed');
        output.textContent = format(result);
      } catch (error) {
        output.classList.add('ks-output-error');
        output.textContent = `Error: ${errorMessage(error)}`;
      } finally {
        setBusy(false);
      }
    })();
  };
  finishPassed.addEventListener('click', () => finishRun(true));
  finishFailed.addEventListener('click', () => finishRun(false));

  reset.addEventListener('click', () => {
    void (async () => {
      if (!runId) return;
      setBusy(true);
      try {
        const result = await trpc.agent.resetRun.mutate({ runId });
        output.textContent = format(result);
      } catch (error) {
        output.classList.add('ks-output-error');
        output.textContent = `Error: ${errorMessage(error)}`;
      } finally {
        setBusy(false);
      }
    })();
  });

  container.append(
    sectionHeading('Agent Console'),
    paragraph(
      'Run source-registered live checks after client and server builds match.'
    ),
    paragraph(
      'Browser agents: use Reddit Desktop mode and verify this visible status in a screenshot; iframe controls may not be directly addressable by browser DOM tools.'
    ),
    expectedLabel,
    readiness,
    fixture,
    commands,
    commandDescription,
    browserSteps,
    controls,
    output
  );

  void (async () => {
    try {
      loadedCommands = await trpc.agent.listCommands.query();
      for (const command of loadedCommands) {
        const option = document.createElement('option');
        option.value = command.id;
        option.textContent = `${command.category}: ${command.id}`;
        commands.append(option);
      }
      renderSelectedCommand();
      await Promise.all([refreshReadiness(), refreshFixture()]);
    } catch (error) {
      output.classList.add('ks-output-error');
      output.textContent = `Unable to load agent commands: ${errorMessage(error)}`;
    }
  })();
};
