let asyncDone = require('async-done');
let gulp = require('gulp');
let gutil = require('gulp-util');
let ddescribeIit = require('gulp-ddescribe-iit');
let shell = require('gulp-shell');
let ghPages = require('gulp-gh-pages');
let gulpFile = require('gulp-file');
let del = require('del');
let clangFormat = require('clang-format');
let gulpFormat = require('gulp-clang-format');
let runSequence = require('run-sequence');
let tslint = require('gulp-tslint');
let webpack = require('webpack');
let exec = require('child_process').exec;
let path = require('path');
let os = require('os');
let remapIstanbul = require('remap-istanbul/lib/gulpRemapIstanbul');

let PATHS = {
  src: 'src/**/*.ts',
  srcIndex: 'src/index.ts',
  specs: 'src/**/*.spec.ts',
  testHelpers: 'src/test/**/*.ts',
  demo: 'demo/**/*.ts',
  demoDist: 'demo/dist/**/*',
  typings: 'typings/index.d.ts',
  jasmineTypings: 'typings/globals/jasmine/index.d.ts',
  demoApiDocs: 'demo/src',
  coverageJson: 'coverage/json/coverage-final.json'
};

const docsConfig = Object.assign({port: 9090}, getLocalConfig());

function platformPath(path) {
  return /^win/.test(os.platform()) ? `${path}.cmd` : path;
}

function webpackCallBack(taskName, gulpDone) {
  return function(err, stats) {
    if (err) {
      throw new gutil.PluginError(taskName, err);
    }
    gutil.log(`[${taskName}]`, stats.toString());
    gulpDone();
  }
}

// Transpiling & Building

gulp.task('clean:build', function() {
  return del('dist/');
});

gulp.task('ngc', function(cb) {
  let executable = path.join(__dirname, platformPath('/node_modules/.bin/ngc'));
  exec(`${executable} -p ./tsconfig-es2015.json`, (e) => {
    if (e) {
      console.log(e);
    }
    del('./dist/waste');
    cb();
  }).stdout.on('data', function(data) {
    console.log(data);
  });
});

gulp.task('umd', function(cb) {
  function ngExternal(ns) {
    let ng2Ns = `@angular/${ns}`;
    return {root: ['ng', ns], commonjs: ng2Ns, commonjs2: ng2Ns, amd: ng2Ns};
  }

  function rxjsExternal(context, request, cb) {
    if (/^rxjs\/add\/observable\//.test(request)) {
      return cb(null, {root: ['Rx', 'Observable'], commonjs: request, commonjs2: request, amd: request});
    } else if (/^rxjs\/add\/operator\//.test(request)) {
      return cb(null, {root: ['Rx', 'Observable', 'prototype'], commonjs: request, commonjs2: request, amd: request});
    } else if (/^rxjs\//.test(request)) {
      return cb(null, {root: ['Rx'], commonjs: request, commonjs2: request, amd: request});
    }
    cb();
  }

  webpack(
      {
        entry: './temp/index.js',
        output: {filename: 'dist/bundles/ngx-toggle.js', library: 'ngb', libraryTarget: 'umd'},
        devtool: 'source-map',
        externals: [
          {
            '@angular/core': ngExternal('core'),
            '@angular/common': ngExternal('common'),
            '@angular/forms': ngExternal('forms'),
            '@ng-bootstrap/ng-bootstrap': {
              root: ['@ng-bootstrap', 'ng-bootstrap'],
              commonjs: '@ng-bootstrap/ng-bootstrap',
              commonjs2: '@ng-bootstrap/ng-bootstrap',
              amd: '@ng-bootstrap/ng-bootstrap'
            }
          },
          rxjsExternal
        ]
      },
      webpackCallBack('webpack', cb));
});

gulp.task('npm', function() {
  let pkgJson = require('./package.json');
  let targetPkgJson = {};
  let fieldsToCopy = ['version', 'description', 'keywords', 'author', 'repository', 'license', 'bugs', 'homepage'];

  targetPkgJson['name'] = '@telenia/ngx-toggle';

  fieldsToCopy.forEach(function(field) {
    targetPkgJson[field] = pkgJson[field];
  });

  targetPkgJson['main'] = 'bundles/ngx-toggle.js';
  targetPkgJson['module'] = 'index.js';
  targetPkgJson['typings'] = 'index.d.ts';

  targetPkgJson.peerDependencies = {};
  Object.keys(pkgJson.dependencies).forEach(function(dependency) {
    targetPkgJson.peerDependencies[dependency] = `${pkgJson.dependencies[dependency]}`;
  });

  return gulp.src('README.md')
      .pipe(gulpFile('package.json', JSON.stringify(targetPkgJson, null, 2)))
      .pipe(gulp.dest('dist'));
});

gulp.task('changelog', function() {
  let conventionalChangelog = require('gulp-conventional-changelog');
  return gulp.src('CHANGELOG.md', {})
      .pipe(conventionalChangelog({preset: 'angular', releaseCount: 1}, {
        // Override release version to avoid `v` prefix for git comparison
        // See https://github.com/conventional-changelog/conventional-changelog-core/issues/10
        currentTag: require('./package.json').version
      }))
      .pipe(gulp.dest('./'));
});

// Testing

function startKarmaServer(isTddMode, isSaucelabs, done) {
  let karmaServer = require('karma').Server;
  let travis = process.env.TRAVIS;

  let config = {configFile: `${__dirname}/karma.conf.js`, singleRun: !isTddMode, autoWatch: isTddMode};

  if (travis) {
    config['reporters'] = ['dots'];
    config['browsers'] = ['Firefox'];
  }

  if (isSaucelabs) {
    config['reporters'] = ['dots', 'saucelabs'];
    config['browsers'] =
        ['SL_CHROME', 'SL_FIREFOX', 'SL_IE10', 'SL_IE11', 'SL_EDGE14', 'SL_EDGE15', 'SL_SAFARI10', 'SL_SAFARI11'];

    if (process.env.TRAVIS) {
      let buildId = `TRAVIS #${process.env.TRAVIS_BUILD_NUMBER} (${process.env.TRAVIS_BUILD_ID})`;
      config['sauceLabs'] = {build: buildId, tunnelIdentifier: process.env.TRAVIS_JOB_NUMBER};
      process.env.SAUCE_ACCESS_KEY = process.env.SAUCE_ACCESS_KEY.split('').reverse().join('');
    }
  }

  new karmaServer(config, done).start();
}

gulp.task('clean:tests', function() {
  return del(['temp/', 'coverage/']);
});

gulp.task('build:tests', ['clean:tests'], (cb) => {
  exec(path.join(__dirname, platformPath('/node_modules/.bin/tsc')), (e) => {
    if (e) {
      console.log(e);
    }
    cb();
  }).stdout.on('data', function(data) {
    console.log(data);
  });
});

gulp.task('ddescribe-iit', function() {
  return gulp.src(PATHS.specs).pipe(ddescribeIit({allowDisabledTests: false}));
});

gulp.task('test', ['build:tests'], function(done) {
  startKarmaServer(false, false, () => {
    asyncDone(() => {
      return gulp.src(PATHS.coverageJson).pipe(remapIstanbul({reports: {'html': 'coverage/html'}}));
    }, done);
  });
});

gulp.task('remap-coverage', function() {
  return gulp.src(PATHS.coverageJson).pipe(remapIstanbul({reports: {'html': 'coverage/html'}}));
});

gulp.task('tdd', ['clean:tests'], (cb) => {
  let executable = path.join(__dirname, platformPath('/node_modules/.bin/tsc'));
  let startedKarma = false;

  exec(`${executable} -w`, (e) => {
    cb(e && e.signal !== 'SIGINT' ? e : undefined);
  }).stdout.on('data', function(data) {
    console.log(data);

    // starting karma in tdd as soon as 'tsc -w' finishes first compilation
    if (!startedKarma) {
      startedKarma = true;
      startKarmaServer(true, false, function(err) {
        process.exit(err ? 1 : 0);
      });
    }
  });
});

gulp.task('saucelabs', ['build:tests'], function(done) {
  startKarmaServer(false, true, function(err) {
    done(err);
    process.exit(err ? 1 : 0);
  });
});

// Formatting

gulp.task('lint', function() {
  return gulp.src([PATHS.src, PATHS.demo, '!demo/src/api-docs.ts'])
      .pipe(tslint({configuration: './tslint.json', formatter: 'prose'}))
      .pipe(tslint.report({summarizeFailureOutput: true}));
});

gulp.task('check-format', function() {
  return doCheckFormat().on('warning', function() {
    console.log('NOTE: this will be promoted to an ERROR in the continuous build');
  });
});

gulp.task('enforce-format', function() {
  return doCheckFormat().on('warning', function() {
    console.log('ERROR: You forgot to run clang-format on your change.');
    console.log('See https://github.com/ngx-toggle/ngx-toggle/blob/master/DEVELOPER.md#clang-format');
    process.exit(1);
  });
});

function doCheckFormat() {
  return gulp
      .src([
        'gulpfile.js', 'karma-test-shim.js', 'misc/api-doc.js', 'misc/api-doc.spec.js', 'misc/demo-gen.js', PATHS.src
      ])
      .pipe(gulpFormat.checkFormat('file', clangFormat));
}

// Demo

gulp.task('generate-docs', function() {
  let getApiDocs = require('./misc/get-doc');
  let docs = `const API_DOCS = ${JSON.stringify(getApiDocs(), null, 2)};\n\nexport default API_DOCS;`;

  return gulpFile('api-docs.ts', docs, {src: true}).pipe(gulp.dest(PATHS.demoApiDocs));
});

gulp.task('generate-plunks', function() {
  let getPlunker = require('./misc/plunk-gen');
  let demoGenUtils = require('./misc/demo-gen-utils');
  let plunks = [];

  demoGenUtils.getDemoComponentNames().forEach(function(componentName) {
    plunks = plunks.concat(demoGenUtils.getDemoNames(componentName).reduce(function(soFar, demoName) {
      soFar.push({name: `${componentName}/demos/${demoName}/plnkr.html`, source: getPlunker(componentName, demoName)});
      return soFar;
    }, []));
  });

  return gulpFile(plunks, {src: true}).pipe(gulp.dest('demo/src/public/app/components'));
});

gulp.task('clean:demo', function() {
  return del('demo/dist');
});

gulp.task('clean:demo-cache', function() {
  return del('.publish/');
});

gulp.task('demo-server', ['generate-docs', 'generate-plunks'], shell.task([
  `webpack-dev-server --mode development --port ${docsConfig.port} --config webpack.demo.js --inline --progress`
]));

gulp.task(
    'build:demo', ['clean:demo', 'generate-docs', 'generate-plunks'],
    shell.task(
        ['webpack --mode production --config webpack.demo.js --progress --profile --bail'], {env: {MODE: 'build'}}));

gulp.task(
    'demo-server:aot', ['generate-docs', 'generate-plunks'],
    shell.task(
        [`webpack-dev-server --mode development --port ${
            docsConfig.port} --config webpack.demo.js --inline --progress`],
        {env: {MODE: 'build'}}));

gulp.task('demo-push', function() {
  return gulp.src(PATHS.demoDist)
      .pipe(ghPages({remoteUrl: 'https://github.com/ngx-toggle/ngx-toggle.github.io.git', branch: 'master'}));
});

// Public Tasks
gulp.task('clean', ['clean:build', 'clean:tests', 'clean:demo', 'clean:demo-cache']);

gulp.task('build', function(done) {
  runSequence('lint', 'enforce-format', 'ddescribe-iit', 'test', 'clean:build', 'ngc', 'umd', 'npm', done);
});

gulp.task('deploy-demo', function(done) {
  runSequence('clean:demo', 'build:demo', 'demo-push', 'clean:demo-cache', done);
});

gulp.task('default', function(done) {
  runSequence('lint', 'enforce-format', 'ddescribe-iit', 'test', done);
});

gulp.task('ci', function(done) {
  runSequence('default', 'build:demo', done);
});

function getLocalConfig() {
  try {
    require.resolve('./local.docs.json');
  } catch (e) {
    return {};
  }

  return require('./local.docs.json');
}
