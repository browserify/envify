const acorn = require('acorn-node')
const dash = require('dash-ast')
const msplice = require('multisplice')
const through = require('through2')

const processEnvPattern = /\bprocess\.env\b/

function equalNodes (a, b) {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'Literal': return a.value === b.value
    case 'Identifier': return a.name === b.name
    case 'MemberExpression': return a.computed === b.computed && equalNodes(a.object, b.object) && equalNodes(a.property, b.property)
  }
  return false
}

module.exports = function (rootEnv) {
  rootEnv = rootEnv || process.env || {}

  return function envify (file, argv) {
    if (/\.json$/.test(file)) return through()

    const buffer = []
    argv = argv || {}

    return through(write, flush)

    function write (data, enc, cb) {
      buffer.push(data)
      cb()
    }

    function transform (source, envs) {
      const args = [].concat(envs[0]._ || []).concat(envs[1]._ || [])
      const purge = args.indexOf('purge') !== -1
      const replacements = []

      function match (node) {
        return (
          node.type === 'MemberExpression' &&
          node.object.type === 'MemberExpression' &&
          node.object.computed === false &&
          node.object.object.type === 'Identifier' &&
          node.object.object.name === 'process' &&
          node.object.property.type === 'Identifier' &&
          node.object.property.name === 'env' &&
          (node.computed ? node.property.type === 'Literal' : node.property.type === 'Identifier')
        )
      }

      const ast = acorn.parse(source)

      dash(ast, {
        leave: function (node) {
          if (match(node)) {
            const key = node.property.name || node.property.value
            for (let i = 0; i < envs.length; i++) {
              const value = envs[i][key]
              if (value !== undefined) {
                replacements.push({ node, value: JSON.stringify(value) })
                return
              }
            }
            if (purge) {
              replacements.push({ node, value: 'undefined' })
            }
          } else if (node.type === 'AssignmentExpression') {
            for (let i = 0; i < replacements.length; ++i) {
              if (equalNodes(replacements[i].node, node.left)) {
                replacements.splice(i, 1)
              }
            }
          }
        }
      })

      const splicer = msplice(source)
      if (replacements.length > 0) {
        replacements.sort(function (a, b) {
          return b.start - a.start
        })
        for (let i = 0; i < replacements.length; i++) {
          const r = replacements[i]
          splicer.splice(r.node.start, r.node.end, r.value)
        }
      }

      return splicer.toString()
    }

    function flush (cb) {
      let source = buffer.join('')

      if (processEnvPattern.test(source)) {
        try {
          source = transform(source, [argv, rootEnv])
        } catch (err) {
          return this.emit('error', err)
        }
      }

      this.push(source)
      this.push(null)
      cb()
    }
  }
}
