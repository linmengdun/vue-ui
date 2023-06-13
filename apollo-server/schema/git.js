const gql = require('graphql-tag')
// // Connectors
const git = require('../connectors/git')

exports.types = gql`
extend type Query {
  branches (projectId: ID!): [Branch]
}

type Branch {
  name: String!
  current: Boolean!
}

extend type Mutation {
  branchCheckout (input: BranchCheckoutInput!): Boolean
}

input BranchCheckoutInput {
  name: String!
  projectId: ID!
}
`

exports.resolvers = {
  Query: {
    branches: (root, { projectId }, context) => git.branches(projectId, context)
  },

  Mutation: {
    branchCheckout: (root, { input }, context) => git.checkout(input, context)
  }
}
