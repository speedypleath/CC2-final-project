import 'dotenv/config';
import readline from 'readline';
import OpenAI from 'openai';
import nlp from 'compromise';
import chalk from 'chalk';
import axios from 'axios';

const DATAMUSE_API_URL = 'https://api.datamuse.com/words';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: chalk.cyan('You: ')
});

// Helper: type out text letter by letter
const typewriter = async (text, delay = 50) => {
  for (const char of text) {
    process.stdout.write(char);
    await new Promise(r => setTimeout(r, delay));
  }
}

const getAntonym = async (word, leftContext, rightContext) => {
  try {
    const res = await axios.get(DATAMUSE_API_URL, {
      params: { rel_ant: word, lc: leftContext, rc: rightContext, max: 10 }
    });
    
    return res.data.map(entry => entry.word)[0];
  } catch (err) {
    console.error('Error fetching antonyms:', err);
    return [];
  }
}

// Unfortunatly, .toNegative() doesn't work as expected.
function negateVerbPhrase(phrase) {
  const doc = nlp(phrase);
  doc.contractions().expand();

  // Get all matches of "to" followed by a verb
  const matches = doc.match('to #Verb');

  // Iterate over all matches
  matches.forEach(match => {
    // Tag the first term ("to") of this match as Auxiliary
    match.terms(0).tag('Auxiliary');
  });

  const verbs = doc.verbs();

  // If it is already negated, return the positive
  if (doc.text().includes('not')) {
    return doc.text().replace('not ', '').replace('not', '');
  }

  if (verbs.found) {
    const isInfinitive = doc.has('to #Verb');
    const hasAuxiliary = doc.has('#Auxiliary');
    const hasAdverb = doc.has('#Adverb');

    if (isInfinitive) {
      // Infinitive: "to go" → "not to go"
      doc.match('to #Verb').insertBefore('not');
      return doc.text();
    }

    if (hasAuxiliary) {
      // Has auxiliary: "is going" → "is not going"
      doc.match('#Auxiliary').insertAfter('not');
      return doc.text();
    }

    if (hasAdverb) {
      // Has adverb: "is going" → "is not going"
      doc.match('#Adverb').insertAfter('not');
      return doc.text();
    }

    const verbText = verbs.text();

    // Continous tense: "is going" → "isn't going"
    if (verbText.includes('ing')) {
      return verbText.replace('ing', 'ing not');
    }

    // special case for "is"
    if (verbText.split(' ').includes('is')) {
      return verbText.replace('is', 'isn\'t');
    }

    // Otherwise: neutral/simple negation
    return verbText.endsWith('s') ? `doesn't ${verbText.slice(0, -1)}` : `don't ${verbText}`;
  }

  return phrase;
}

const glitchWord = (word) => {
  const glitchChars = ['@', '#', '%', '&', '*', '!', '1', '0', '~', '^', '⧖', '⛧', '⟁'];
  const zalgoUp = ['̍','̎','̄','̅','̿','̑','̆','̐','͒','͗','̚'];
  const zalgoDown = ['̖','̗','̘','̙','̜','̝','̞','̟','̠','̤','̥','̦','̩','̪','̫','̬','̭','̮','̯'];
  const zalgoMid = ['̕','̛','̀','́','͘','̡','̢','̧','̨','̴','̵','̶','͜','͝','͞','͟','͠','͢','̸','̷'];

  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

  return word
    .split('')
    .map((char, i) => {
      let out = char;

      // Randomly uppercase or lowercase
      if (Math.random() < 0.1) out = Math.random() < 0.5 ? char.toUpperCase() : char.toLowerCase();

      // Randomly replace character
      if (Math.random() < 0.25) out = rand(glitchChars);

      // Randomly duplicate character
      if (Math.random() < 0.1) out += out;

      // Randomly insert zalgo effects
      if (Math.random() < 0.4) {
        out += rand(zalgoUp) + rand(zalgoMid) + rand(zalgoDown);
      }

      return out;
    })
    .join('');
};


const tokenize = (text) => {
  const doc = nlp(text);
  doc.contractions().expand(); // Handle "don't", "she's", etc.
  // Get all matches of "to" followed by a verb
  const matches = doc.match('to #Verb');

  // Iterate over all matches
  matches.forEach(match => {
    // Tag the first term ("to") of this match as Auxiliary
    match.terms(0).tag('Auxiliary');
  });

  const terms = doc.terms().data(); // All terms
  const allTerms = doc.terms().termList();
  const used = new Set(); // Indices already grouped into a compound (like "is going")
  const tokens = [];

  // Extract verb phrases (compound and infinitive)
  const verbPhrases = doc.verbs();

  // Track which terms are part of verb phrases
  const verbIndices = verbPhrases.json().map(obj =>
    obj.terms.map(term => term.index)
  );

  // Flatten and mark used indices
  verbIndices.flat().forEach((i) => used.add(i[1]));
  // Push verb tokens
  verbPhrases.forEach((m) => {
    tokens.push({
      type: 'verb',
      text: m.text(),
      doc: m,
      index: allTerms.findIndex(term => term === m.termList()[0]), // first word index
    });
  });

  // Now go through all terms and categorize remaining tokens
  terms.forEach((term, i) => {
    if (used.has(i)) return; // skip if part of a verb phrase

    const tag = term.terms[0].tags.includes('Noun')
      ? 'noun'
      : term.terms[0].tags.includes('Adjective')
      ? 'adjective'
      : 'other';

    tokens.push({
      type: tag,
      text: term.terms[0].text,
      doc: doc.match(term.terms[0].text),
      index: i,
    });
  });

  // Sort by index to preserve sentence order
  tokens.sort((a, b) => a.index - b.index);

  return tokens;
}

export const respond = async (input) => {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that always replies in exactly one sentence. Respond in second person and use many verbs and adjectives' },
        { role: 'user', content: input }
      ]
    });

    const raw = response.choices?.[0]?.message?.content?.trim() ?? '[No response]';
    const tokens = tokenize(raw);
    const nouns = tokens.filter(t => t.type === 'noun');
    
    process.stdout.write(chalk.yellow('[THINKING]'));
    for (let i = 0; i < 3; i++) {
      await typewriter('\b', 1000);
      await typewriter(chalk.yellow('.'), 10);
      await typewriter(chalk.yellow(']'), 10);
    }
    await typewriter('\n');

    const firstWords = raw.split(' ').slice(0, 10).join(' ');
    await typewriter(chalk.green(firstWords));
    await typewriter('...', 500);
    await typewriter('\b'.repeat(firstWords.length + 3));
    let lastAlteredVerb = 1;
    for (const [index, token] of tokens.entries()) {
        await typewriter(token.text);
        if (index === 0) {
          await typewriter(' ');
          continue;
        }
        
        if (token.type === 'verb') {
          lastAlteredVerb += 1;
        }

        if (token.type === 'verb' && Math.random() < lastAlteredVerb * 0.30) {
          lastAlteredVerb = 0;
          const negated = negateVerbPhrase(token.text);
          await typewriter('...', 300);
          await typewriter('\b'.repeat(token.text.length + 3));
          await typewriter(chalk.magenta(negated + ' '));
          continue;
        }

        if (Math.random() < 0.15) {
          // Occasionally glitch a word
          const glitchedWord = glitchWord(token.text);
          await typewriter('\b'.repeat(token.text.length));
          await typewriter(chalk.red(glitchedWord + ' '));
          continue;
        }

        if (token.type === 'adjective') {
          const leftContext = tokens.slice(0, index).map(t => t.text).join(' ');
          const rightContext = tokens.slice(index + 1).map(t => t.text).join(' ');
          const antonym = await getAntonym(token.text, leftContext, rightContext);
          if (!antonym) {
            await typewriter(' ');
            continue;
          }
          await typewriter('...', 300);
          await typewriter('\b'.repeat(token.text.length + 3));
          await typewriter(chalk.cyan(antonym + ' '));
          continue;
        }

        if (token.type === 'noun' && Math.random() < 0.2) {
          const randomNoun = nouns[Math.floor(Math.random() * nouns.length)].text;
          await typewriter('...', 300);
          await typewriter('\b'.repeat(token.text.length + 3));
          await typewriter(chalk.yellow(randomNoun + ' '));
          continue;
        }

        await typewriter(' ');
    }
    console.log('\n');
  } catch (err) {
    console.error(chalk.red('Error:'), err.message || err);
  }
}

const startChat = () => {
  rl.prompt();
  rl.on('line', async (line) => {
    const input = line.trim();
    if (input.toLowerCase() === 'exit') {
      console.log(chalk.red('\nExiting Glitched Echo...'));
      rl.close();
      return;
    }
    await respond(input);
    rl.prompt();
  });
}

startChat();