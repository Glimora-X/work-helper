import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeExecutionStages,
  layoutDeployDagPositions,
  resolveDeployLinks,
  serialLinks,
  validateDeployGraph,
} from '../../src/lib/deploy-dag.ts';

describe('deploy-dag', () => {
  it('serialLinks builds chain edges', () => {
    assert.deepEqual(serialLinks(['a', 'b', 'c']), [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]);
  });

  it('computeExecutionStages splits fork into parallel stage', () => {
    const nodes = ['biz-core', 'saas-cc-web', 'hsy-h5-mainapp'];
    const links = [
      { source: 'biz-core', target: 'saas-cc-web' },
      { source: 'biz-core', target: 'hsy-h5-mainapp' },
    ];
    assert.deepEqual(computeExecutionStages(nodes, links), [
      ['biz-core'],
      ['saas-cc-web', 'hsy-h5-mainapp'],
    ]);
  });

  it('computeExecutionStages keeps serial pipeline as separate stages', () => {
    const nodes = ['a', 'b', 'c'];
    assert.deepEqual(computeExecutionStages(nodes, resolveDeployLinks(nodes)), [['a'], ['b'], ['c']]);
  });

  it('layoutDeployDagPositions places fork siblings on same row', () => {
    const nodes = ['biz-core', 'saas-cc-web', 'hsy-h5-mainapp'];
    const links = [
      { source: 'biz-core', target: 'saas-cc-web' },
      { source: 'biz-core', target: 'hsy-h5-mainapp' },
    ];
    const positions = layoutDeployDagPositions(nodes, links);
    assert.equal(positions.get('biz-core')?.y, 0);
    assert.equal(positions.get('saas-cc-web')?.y, positions.get('hsy-h5-mainapp')?.y);
    assert.notEqual(positions.get('saas-cc-web')?.x, positions.get('hsy-h5-mainapp')?.x);
  });

  it('computeExecutionStages joins parallel nodes before downstream stage', () => {
    const nodes = ['mdf', 'mdf-biz', 'mdf-ui-web', 'saas-cc-web-metapage'];
    const links = [
      { source: 'mdf', target: 'saas-cc-web-metapage' },
      { source: 'mdf-biz', target: 'saas-cc-web-metapage' },
      { source: 'mdf-ui-web', target: 'saas-cc-web-metapage' },
    ];
    assert.deepEqual(computeExecutionStages(nodes, links), [
      ['mdf', 'mdf-biz', 'mdf-ui-web'],
      ['saas-cc-web-metapage'],
    ]);
  });

  it('layoutDeployDagPositions places join target below parallel sources', () => {
    const nodes = ['mdf', 'mdf-biz', 'mdf-ui-web', 'saas-cc-web-metapage'];
    const links = [
      { source: 'mdf', target: 'saas-cc-web-metapage' },
      { source: 'mdf-biz', target: 'saas-cc-web-metapage' },
      { source: 'mdf-ui-web', target: 'saas-cc-web-metapage' },
    ];
    const positions = layoutDeployDagPositions(nodes, links);
    assert.equal(positions.get('saas-cc-web-metapage')?.y, 150);
    assert.equal(positions.get('mdf')?.y, positions.get('mdf-biz')?.y);
    assert.equal(positions.get('mdf-biz')?.y, positions.get('mdf-ui-web')?.y);
  });

  it('validateDeployGraph rejects cycles', () => {
    const nodes = ['a', 'b'];
    const links = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ];
    assert.equal(validateDeployGraph(nodes, links).valid, false);
  });
});
