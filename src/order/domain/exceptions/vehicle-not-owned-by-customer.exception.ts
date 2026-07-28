import { DomainException } from "../../../common/exceptions/domain.exception";

export class VehicleNotOwnedByCustomerException extends DomainException {
  constructor(vehicleId: string, customerId: string) {
    super(
      "VEHICLE_NOT_OWNED_BY_CUSTOMER",
      `Vehicle ${vehicleId} does not belong to customer ${customerId}.`,
    );
  }
}
