const quotaCalculator = require('./libs/quotaCalculator');

const testData = {
  address: 'PXXaSczoZcuJEwxYKhaC9pV1JBvwi6UjSw',
  user_reg_date: 1561641978,
  addr_reg_date: 1561641915,
  reputation: 8,
  balance: 466427047,
  trial: true,
  post_unspent: 30,
  post_spent: 0,
  score_unspent: 200,
  score_spent: 0,
  complain_unspent: 12,
  complain_spent: 0,
  number_of_blocking: 1,
  comment_spent: 0,
  comment_unspent: 300,
  comment_score_spent: 0,
  comment_score_unspent: 600,
};

console.log('Auth', quotaCalculator(testData));
