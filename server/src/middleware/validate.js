export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: {
          message: 'Validation failed.',
          details: result.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })),
        },
      });
    }
    // Express query/params may be read-only; keep parsed values in res.locals.
    res.locals.validated ??= {};
    res.locals.validated[source] = result.data;
    return next();
  };
}

export const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
