// From https://github.com/sergeyt/parse-diff

const detachedRegex = /^(\*?\s+)\((?:HEAD )?detached (?:from|at) (\S+)\)\s+([a-z0-9]+)\s(.*)$/;
const branchRegex = /^(\*?\s+)(remotes\/origin\/)?(\S+)\s+([a-z0-9]+)\s(.*)$/;
const svnLogRegex = /^(\w+)/;

module.exports = function (input) {
  let currentName
  const branchSummary = []

  input.split('\n')
    .forEach(function (line) {
        var detached = true;
        var branch = detachedRegex.exec(line);
        if (!branch) {
          detached = false;
          branch = branchRegex.exec(line);
        }

        if (branch) {
          if (branch[1].charAt(0) === '*') {
            currentName = branch[3]
          }

          if (branch[2]) {
            branchSummary.push({
              name: branch[3],
              commit: branch[4],
              label: branch[5]
            })
          }
        }
    });

  branchSummary.forEach(b => b.current = b.name === currentName)
  return branchSummary
}

module.exports.svn = function (input) {
  const branchSummary = {
    current: true,
    name: 'trunk'
  }
  
  input.split('\n')
    .forEach(line => {
      const info = svnLogRegex.exec(line)
      if (info) {
        branchSummary.label = info[0]
      }
    })

  return [branchSummary]
}
