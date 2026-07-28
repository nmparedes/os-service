Feature: Complete service order flow

  Scenario: Finish a service order through the happy path Saga flow
    Given a valid service order is ready to start its Saga
    When the budget is created and approved
    And the payment is created and approved
    And the stock is reserved
    And the workshop starts and finishes the execution
    Then the service order is finished
    And the Saga is completed
    And the expected commands were published without compensation
    And the same correlation and Saga identifiers are preserved through the flow
