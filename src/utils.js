import chalk from 'chalk';
import cheerio from 'cheerio';
import * as dotenv from 'dotenv';
import fs from 'fs';
import { globbySync } from 'globby';
import { decode, encode } from 'html-entities';
import path from 'path';
import replace from 'replace-in-file';
import shell from 'shelljs';

import {
  androidManifestXml,
  androidValuesStrings,
  appJson,
  getIosFoldersAndFilesPaths,
  getIosModifyFilesContentOptions,
  getOtherModifyFilesContentOptions,
  iosPlist,
  iosXcodeproj,
  packageJson,
} from './paths';

dotenv.config();

const APP_PATH = process.env.DEV_APP_PATH || process.cwd();
const PROMISE_DELAY = 200;
const MAX_NAME_LENGTH = 30;
const NON_LANGUAGE_ALPHANUMERIC_REGEX = /[^\p{L}\p{N}]+/gu;
const MIN_LANGUAGE_ALPHANUMERIC_NAME_LENGTH = 4;
const VALID_BUNDLE_ID_REGEX = /^([a-zA-Z]([a-zA-Z0-9_])*\.)+[a-zA-Z]([a-zA-Z0-9_])*$/u;

const pluralize = (count, noun, suffix = 'es') => `${count} ${noun}${count !== 1 ? suffix : ''}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export const cleanString = str => str.replace(NON_LANGUAGE_ALPHANUMERIC_REGEX, '');
export const decodeXmlEntities = name => decode(name, { level: 'xml' });
export const encodeXmlEntities = name =>
  encode(name, { mode: 'nonAscii', level: 'xml', numeric: 'hexadecimal' });

export const checkGitRepoStatus = () => {
  shell.cd(APP_PATH);
  const output = shell.exec('git status', { silent: true }).stdout;
  const isClean = output.includes('nothing to commit, working tree clean');

  if (!isClean) {
    console.log(
      `The directory is not clean. There are changes that have not been committed to the Git repository.
Clean it first and try again.`
    );
    process.exit();
  }
};

export const validateGitRepo = () => {
  shell.cd(APP_PATH);
  const isGitRepository =
    shell.exec('git rev-parse --is-inside-work-tree', { silent: true }).code === 0;

  if (!isGitRepository) {
    console.log('This is not a git repository');
    process.exit();
  }
};

export const validateCreation = () => {
  const fileExists =
    fs.existsSync(globbySync(path.join(APP_PATH, iosPlist))[0]) &&
    fs.existsSync(path.join(APP_PATH, androidValuesStrings));

  if (!fileExists) {
    console.log('Directory should be created using "react-native init".');
    process.exit();
  }
};

export const validateNewName = (newName, programOptions) => {
  if (!(newName.length <= MAX_NAME_LENGTH)) {
    console.log(`New app name "${newName}" is too long`);
    process.exit();
  }

  const cleanNewName = cleanString(newName);
  const isCleanNewNameLengthValid = cleanNewName.length >= MIN_LANGUAGE_ALPHANUMERIC_NAME_LENGTH;
  const hasPathContentStr = !!programOptions.pathContentStr;

  // Ask user to provide a custom path and content string if the cleanNewName is less than MIN_LANGUAGE_ALPHANUMERIC_NAME_LENGTH
  if (!isCleanNewNameLengthValid && !hasPathContentStr) {
    console.log(
      `Please provide path and content string using "-p [value]" or "--pathContentStr [value]" option to be used in renaming the app\'s folders, files and their contents.
example: react-native-rename "M&Ms" -p "MMsChocolates"`
    );
    process.exit();
  }
};

export const validatePathContentStr = value => {
  const cleanValue = cleanString(value ?? '');
  const isCleanValueLengthValid = cleanValue.length >= MIN_LANGUAGE_ALPHANUMERIC_NAME_LENGTH;

  if (!isCleanValueLengthValid) {
    console.log(
      `The value provided in --pathContentString or -p option is too short or contains special characters.`
    );
    process.exit();
  }
};

export const validateBundleID = bundleID => {
  if (!VALID_BUNDLE_ID_REGEX.test(bundleID)) {
    console.log(
      `The bundle identifier "${bundleID}" is not valid. It should be a reverse DNS name, e.g. com.example.MyApp`
    );
    process.exit();
  }

  const segments = bundleID.split('.');

  if (segments.length < 2) {
    console.log(
      `The bundle identifier "${bundleID}" is not valid. It should contain at least 2 segments, e.g. com.example.MyApp or com.example`
    );
    process.exit();
  }
};

const getCurrentNameFromXml = ({ filepath, selector }) => {
  const xml = fs.readFileSync(filepath, 'utf8');
  const $ = cheerio.load(xml, { xmlMode: true, decodeEntities: false });
  const element = $(selector);

  return decodeXmlEntities(element.text());
};

export const getIosCurrentName = () => {
  const filepath = globbySync(path.join(APP_PATH, iosPlist))[0];
  const selector = 'dict > key:contains("CFBundleDisplayName") + string';

  return getCurrentNameFromXml({ filepath, selector });
};

export const getAndroidCurrentName = () => {
  const filepath = path.join(APP_PATH, androidValuesStrings);
  const selector = 'resources > string[name="app_name"]';

  return getCurrentNameFromXml({ filepath, selector });
};

export const getIosXcodeProjectPathName = () => {
  const xcodeProjectPath = globbySync(path.join(APP_PATH, iosXcodeproj), {
    onlyDirectories: true,
  });

  return xcodeProjectPath[0].split('/').pop().replace('.xcodeproj', '');
};

const renameFoldersAndFiles = async ({
  foldersAndFilesPaths,
  currentPathContentStr,
  newPathContentStr,
}) => {
  const promises = foldersAndFilesPaths.map(async (filePath, index) => {
    await delay(index * PROMISE_DELAY);
    const oldPath = path.join(APP_PATH, filePath);
    const newPath = path.join(
      APP_PATH,
      filePath.replace(cleanString(currentPathContentStr), cleanString(newPathContentStr))
    );

    if (oldPath === newPath) {
      return console.log(`.${oldPath}`, chalk.yellow('NOT RENAMED'));
    }

    new Promise(resolve => {
      if (!fs.existsSync(oldPath)) {
        return resolve();
      }

      const shellMove = shell.mv('-f', oldPath, newPath);

      if (shellMove.code !== 0) {
        console.log(chalk.red(shellMove.stderr));
      }

      resolve();
      console.log(`.${newPath}`, chalk.green('RENAMED'));
    });
  });

  await Promise.all(promises);
};

export const renameIosFoldersAndFiles = async newPathContentStr => {
  const currentPathContentStr = getIosXcodeProjectPathName();
  const foldersAndFilesPaths = getIosFoldersAndFilesPaths({
    currentPathContentStr,
    newPathContentStr,
  });
  await renameFoldersAndFiles({
    foldersAndFilesPaths,
    currentPathContentStr,
    newPathContentStr,
  });
};

export const modifyFilesContent = async modifyFilesContentOptions => {
  const promises = modifyFilesContentOptions.map(async (option, index) => {
    await delay(index * PROMISE_DELAY);
    const updatedOption = {
      ...option,
      countMatches: true,
      allowEmptyPaths: true,
      files: option.files.map(file => path.join(APP_PATH, file)),
    };

    try {
      const results = await replace(updatedOption);
      results.map(result => {
        const hasChanged = result.hasChanged;
        const message = `${hasChanged ? 'MODIFIED' : 'NOT MODIFIED'} (${pluralize(
          result.numMatches,
          'match'
        )})`;
        console.log(`.${result.file}`, hasChanged ? chalk.green(message) : chalk.yellow(message));
      });
    } catch (error) {
      const filePath = error.message.replace('No files match the pattern:', '').trim();
      console.log(`.${filePath}`, chalk.yellow('NOT FOUND'));
    }
  });

  await Promise.all(promises);
};

export const modifyIosFilesContent = async ({
  currentName,
  newName,
  currentPathContentStr,
  newPathContentStr,
  bundleID,
}) => {
  const modifyFilesContentOptions = getIosModifyFilesContentOptions({
    currentName,
    newName,
    currentPathContentStr,
    newPathContentStr,
    bundleID,
  });
  await modifyFilesContent(modifyFilesContentOptions);
};

const getAppJsonContent = () => {
  return JSON.parse(fs.readFileSync(path.join(APP_PATH, appJson), 'utf8'));
};

const getPackageJsonContent = () => {
  return JSON.parse(fs.readFileSync(path.join(APP_PATH, packageJson), 'utf8'));
};

export const modifyOtherFilesContent = async ({ newName, newPathContentStr }) => {
  const appJsonContent = getAppJsonContent();
  const packageJsonContent = getPackageJsonContent();

  const modifyFilesContentOptions = getOtherModifyFilesContentOptions({
    newName,
    newPathContentStr,
    appJsonName: appJsonContent?.name,
    appJsonDisplayName: appJsonContent?.displayName,
    packageJsonName: packageJsonContent?.name,
  });
  await modifyFilesContent(modifyFilesContentOptions);
};

export const getAndroidBundleID = async () => {
  const data = await fs.promises.readFile(path.join(APP_PATH, androidManifestXml), 'utf8');
  return data.match(/package="(.*)"/)[1];
};

export const showSuccessMessages = newName => {
  console.log(
    `
${chalk.green('SUCCESS! 🎉 🎉 🎉')} Your app has been renamed to "${chalk.yellow(newName)}".
${chalk.yellow(
  'Please make sure to run "npx pod-install" and "watchman watch-del-all" before running the app.'
)}

`
  );
};

export const gitStageChanges = () => {
  shell.cd(APP_PATH);
  shell.exec('git add .');
};
