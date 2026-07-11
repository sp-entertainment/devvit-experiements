import { reddit } from '@devvit/web/server';

export const createPost = async (title = '<% name %>') => {
  return await reddit.submitCustomPost({
    title,
  });
};
