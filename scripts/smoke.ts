import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import {
  critiquePlacement,
  generateRawLies,
  optimizePlacement,
  refineLies,
  synthesizeFact,
} from '../src/core/agents/index';

const row = {
  question: 'What is a group of lions called?',
  choices: ['Family', 'Group', 'School', 'Pride'],
  answer: 'Pride',
  category: 'animals',
};

async function main() {
  console.log(`model: ${process.env.DEEPSEEK_MODEL ?? 'deepseek-flash'}`);

  const synth = await synthesizeFact(row);
  console.log('\nSYNTHESIZE');
  console.log(JSON.stringify(synth, null, 2));
  if (synth.data.status !== 'ok' || !synth.data.statement || !synth.data.answer) {
    throw new Error(`Synthesis rejected: ${synth.data.reason ?? 'unknown reason'}`);
  }

  const architect = await optimizePlacement(
    {
      fact: synth.data.statement,
      answer: synth.data.answer,
      category: row.category,
      lies: [],
    },
    [],
    '',
    'English',
  );
  console.log('\nARCHITECT');
  console.log(JSON.stringify(architect, null, 2));

  const critic = await critiquePlacement(
    architect.data.newFact,
    architect.data.newAnswer,
    'English',
  );
  console.log('\nCRITIC');
  console.log(JSON.stringify(critic, null, 2));

  const generated = await generateRawLies(
    architect.data.newFact,
    architect.data.newAnswer,
    row.category,
    'English',
  );
  console.log('\nGENERATOR');
  console.log(JSON.stringify(generated, null, 2));

  const edited = await refineLies(
    architect.data.newFact,
    generated.data.rawLies,
    'English',
  );
  console.log('\nEDITOR');
  console.log(JSON.stringify(edited, null, 2));

  const total = [
    synth.usage,
    architect.usage,
    critic.usage,
    generated.usage,
    edited.usage,
  ].reduce((sum, usage) => sum + usage.estimatedCost, 0);
  console.log(`\nEstimated cost: $${total.toFixed(6)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
