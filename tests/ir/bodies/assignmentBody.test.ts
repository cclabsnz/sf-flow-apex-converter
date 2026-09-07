import { parseAssignmentBody } from '../../../src/ir/bodies/assignmentBody.js';

describe('parseAssignmentBody', () => {
  it('reads a single assignment item, which xml2js does not wrap', () => {
    // Real shape from exampleflow.xml.
    const body = parseAssignmentBody({
      name: 'Set_Error',
      assignmentitems: {
        assigntoreference: 'ValidationMessage.Message',
        operator: 'Assign',
        value: { elementreference: 'AmountForCommissionCalculationNotEnteredError' },
      },
    });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toEqual({
      target: 'ValidationMessage.Message',
      operator: 'Assign',
      value: { kind: 'reference', raw: 'AmountForCommissionCalculationNotEnteredError' },
    });
  });

  it('reads every item of a multi-item assignment', () => {
    const body = parseAssignmentBody({
      assignmentitems: [
        { assigntoreference: 'Total', operator: 'Add', value: { numbervalue: 1 } },
        { assigntoreference: 'Names', operator: 'AddItem', value: { elementreference: 'Loop.Name' } },
      ],
    });
    expect(body.items.map((i) => i.operator)).toEqual(['Add', 'AddItem']);
    expect(body.items[1].value).toEqual({ kind: 'reference', raw: 'Loop.Name' });
  });

  it('keeps the Flow operator verbatim rather than mapping it to Apex', () => {
    // Translation is the emitter's job and needs type information this layer
    // does not have. Mapping here would bake in a guess.
    const body = parseAssignmentBody({
      assignmentitems: { assigntoreference: 'X', operator: 'RemoveAfterFirst', value: { stringvalue: 'a' } },
    });
    expect(body.items[0].operator).toBe('RemoveAfterFirst');
  });

  it('yields an empty item list for an assignment with none', () => {
    expect(parseAssignmentBody({ name: 'A' }).items).toEqual([]);
  });
});
