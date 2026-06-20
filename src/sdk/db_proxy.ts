export class DbProxy {
  public connect(connectionString: string): any {
    console.log(
      `Plugin establishing secure connection to: ${connectionString}`,
    );
    return {
      queryOne: async (sql: string, params: any[]) => {
        console.log(`Executing safe query: ${sql}`);
        return {};
      },
    };
  }
}
