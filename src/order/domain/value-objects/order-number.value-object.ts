import { DomainException } from "../../../common/exceptions/domain.exception";

export class OrderNumber {
  private readonly valueInternal: string;

  private constructor(value: string) {
    this.valueInternal = value;
  }

  static create(date: Date, sequence: number): OrderNumber {
    if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new DomainException(
        "INVALID_DATE",
        "Date must be a valid Date instance.",
      );
    }

    if (!Number.isInteger(sequence) || sequence <= 0) {
      throw new DomainException(
        "INVALID_SEQUENCE",
        "Sequence must be a positive integer.",
      );
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const paddedSequence = String(sequence).padStart(4, "0");
    const value = `OS-${year}${month}${day}-${paddedSequence}`;

    if (!this.isValid(value)) {
      throw new DomainException(
        "INVALID_ORDER_NUMBER",
        "Order number is invalid.",
      );
    }

    return new OrderNumber(value);
  }

  static fromString(value: string): OrderNumber {
    if (!this.isValid(value)) {
      throw new DomainException(
        "INVALID_ORDER_NUMBER",
        "Order number is invalid.",
      );
    }

    return new OrderNumber(value);
  }

  static isValid(value: string): boolean {
    if (!value || typeof value !== "string") {
      return false;
    }

    return /^OS-\d{8}-\d{4}$/.test(value);
  }

  get value(): string {
    return this.valueInternal;
  }

  format(): string {
    return this.valueInternal;
  }

  equals(other: OrderNumber): boolean {
    return Boolean(other) && this.valueInternal === other.valueInternal;
  }

  toString(): string {
    return this.valueInternal;
  }
}
