export type Message = {
	topic: string;
	payload: string;
	retain: boolean;
};

export type Handler = (message: Message) => void;

export type PublishOptions = {
	retain?: boolean;
};

/**
 * The slice of MQTT knell relies on. A transport announces itself on its
 * status topic: `online` on every (re)connect, `offline` when it ends or,
 * by way of the last will, when it vanishes.
 */
export type Transport = {
	publish(topic: string, payload: string, options?: PublishOptions): Promise<void>;
	subscribe(filter: string, handler: Handler): Promise<void>;
	end(): Promise<void>;
};
