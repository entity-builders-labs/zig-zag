const path = require('path');
const beSrc = path.resolve(__dirname, '../../be/src');

module.exports = {
  rootDir: __dirname,
  roots: ['<rootDir>/test'],
  testRegex: '.*\\.test\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      require.resolve('ts-jest', { paths: [path.resolve(__dirname, '../../be')] }),
      { tsconfig: path.join(__dirname, 'tsconfig.json') },
    ],
  },
  moduleNameMapper: {
    '^src/(.*)$': `${beSrc}/$1`,
    '^@core/(.*)$': `${beSrc}/core/$1`,
    '^@shared/(.*)$': `${beSrc}/shared/$1`,
    '^@tours/(.*)$': `${beSrc}/modules/tours/$1`,
    '^@integrations/(.*)$': `${beSrc}/modules/integrations/$1`,
  },
  testEnvironment: 'node',
};
