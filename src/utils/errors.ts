export class AppError extends Error {
  public readonly statusCode: number;
  public readonly success: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.success = false;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = "Bad Request") {
    super(message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden") {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Not Found") {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Conflict") {
    super(message, 409);
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = "Internal Server Error") {
    super(message, 500);
  }
}
