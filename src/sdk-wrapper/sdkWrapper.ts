import OT from '@opentok/client';
import SDKError from './errors';
import State from './state';
import {
  Credentials, StreamType
} from "./models";

export class OpenTokSDK extends State {

  constructor(credentials: Credentials) {
    super(credentials);
    this.session = OT.initSession(credentials.apiKey, credentials.sessionId);
  }

  /**
   * Determines if a connection object is my local connection
   * @param connection - An OpenTok connection object
   */
  isMe(connection: OT.Connection): boolean {
    return this.session &&
      this.session.connection.connectionId === connection.connectionId;
  }

  /**
   * Wrap OpenTok session events
   */
  setInternalListeners() {
    if (this.session) {
      /**
       * Wrap session events and update state when streams are created
       * or destroyed
       */
      this.session.on('streamCreated', ({ stream }) => this.addStream(stream));
      this.session.on('streamDestroyed', ({ stream }) => this.removeStream(stream));
      this.session.on('sessionConnected sessionReconnected', () => this.connected = true);
      this.session.on('sessionDisconnected', () => this.connected = false);
    }
  }

  /**
   * Register a callback for a specific event, pass an object
   * with event => callback key/values (or an array of objects)
   * to register callbacks for multiple events.
   * @param events - The name of the events
   * @param callback
   * https://tokbox.com/developer/sdks/js/reference/Session.html#on
   */
  on(events: string | object, callback?: Function) {
    if (typeof events === 'object') {
      bindListeners(this.session, this, events);
    } else if (callback) {
      bindListener(this.session, this, events, callback);
    }
  }

  /**
   * Remove a callback for a specific event. If no parameters are passed,
   * all callbacks for the session will be removed.
   * @param events - The name of the events
   * https://tokbox.com/developer/sdks/js/reference/Session.html#off
   */
  off(...events: string[]) {
    this.session.off(...events)
  }

  /**
   * Enable or disable local publisher audio
   * @param enabled Is audio published?
   */
  enablePublisherAudio(enabled: boolean) {
    Object.keys(this.publishers.camera).forEach((publisherId) => {
      this.publishers.camera[publisherId].publishAudio(enabled);
    });
  }

  /**
   * Enable or disable local publisher video
   * @param enabled Is audio published?
   */
  enablePublisherVideo(enabled: boolean) {
    Object.keys(this.publishers.camera).forEach((publisherId) => {
      this.publishers.camera[publisherId].publishVideo(enabled);
    });
  }

  /**
   * Enable or disable local subscriber audio
   * @param streamId Stream Id to enable/disable
   * @param enabled Is audio enabled?
   */
  enableSubscriberAudio(streamId: string, enabled: boolean) {
    const subscriberId = this.streamMap[streamId];
    const subscriber = this.subscribers.camera[subscriberId] || this.subscribers.screen[subscriberId];
    subscriber && subscriber.subscribeToAudio(enabled);
  }

  /**
   * Enable or disable local subscriber video
   * @param streamId Stream Id to enable/disable
   * @param enabled Is audio enabled?
   */
  enableSubscriberVideo(streamId: string, enabled: boolean) {
    const subscriberId = this.streamMap[streamId];
    const subscriber = this.subscribers.camera[subscriberId] || this.subscribers.screen[subscriberId];
    subscriber && subscriber.subscribeToVideo(enabled);
  }

  /**
   * Create and publish a stream
   * @param element The target element
   * @param properties The publisher properties
   * @param eventListeners An object with eventName/callback key/value pairs
   * @param preview Create a publisher with publishing to the session
   */
  async publish(element: string | HTMLElement, properties: OT.PublisherProperties, eventListeners: Object = null, preview: boolean = false) {
    const publisher = await this.initPublisher(element, properties);

    if (eventListeners && preview) {
      bindListeners(publisher, this, eventListeners);
      return publisher; 8
    } else {
      return await this.publishPreview(publisher);
    }
  }

  /**
   * Publish a 'preview' stream to the session
   * @param publisher An OpenTok publisher object
   */
  async publishPreview(publisher: OT.Publisher): Promise<OT.Publisher> {
    return await (new Promise((resolve, reject) => {
      this.session.publish(publisher, (error) => {
        error && reject(error);
        this.addPublisher(publisher.stream.videoType as StreamType, publisher);
        resolve(publisher);
      });
    }));
  }

  /**
   * Stop publishing a stream
   * @param publisher An OpenTok publisher object
   */
  unpublish(publisher) {
    const type = publisher.stream.videoType;
    this.session.unpublish(publisher);
    this.removePublisher(type, publisher);
  }

  /**
   * Subscribe to stream
   * @param stream
   * @param container The id of the container or a reference to the element
   * @param properties 
   * @param eventListeners An object eventName/callback key/value pairs
   * https://tokbox.com/developer/sdks/js/reference/Session.html#subscribe
   */
  async subscribe(stream: OT.Stream, container: string | HTMLElement, properties: OT.SubscriberProperties, eventListeners: Object = null): Promise<OT.Subscriber> {
    return await (new Promise((resolve, reject) => {
      const subscriber = this.session.subscribe(stream, container, properties, (error) => {
        if (error) {
          reject(error);
        } else {
          this.addSubscriber(subscriber);
          if (eventListeners) {
            bindListeners(subscriber, this, eventListeners);
          }
          resolve(subscriber);
        }
      });
    }));
  }

  /**
   * Unsubscribe from a stream and update the state
   * @param subscriber An OpenTok subscriber object
   */
  async unsubscribe(subscriber: OT.Subscriber): Promise<void> {
    return await (new Promise((resolve) => {
      this.session.unsubscribe(subscriber);
      this.removeSubscriber(subscriber);
      resolve();
    }));
  }

  /**
   * Connect to the OpenTok session
   * @param eventListeners An object with eventName/callback key/value pairs
   */
  async connect(eventListeners: Object = null): Promise<void> {
    this.off();
    this.setInternalListeners();
    if (eventListeners) {
      this.on(eventListeners);
    }
    return await (new Promise((resolve, reject) => {
      const { token } = this.credentials;
      this.session.connect(token, (error) => {
        error ? reject(error) : resolve();
      });
    }));
  }

  /**
   * Force a remote connection to leave the session
   * @param connection Connection to disconnect
   */
  async forceDisconnect(connection: OT.Connection): Promise<void> {
    return await (new Promise((resolve, reject) => {
      this.session.forceDisconnect(connection, (error) => {
        error ? reject(error) : resolve();
      });
    }));
  }

  /**
   * Force the publisher of a stream to stop publishing the stream
   * @param stream Stream to unpublish 
   */
  async forceUnpublish(stream: OT.Stream): Promise<void> {
    return await (new Promise((resolve, reject) => {
      this.session.forceUnpublish(stream, (error) => {
        error ? reject(error) : resolve();
      });
    }));
  }

  /**
   * Send a signal using the OpenTok signaling apiKey
   * @param type Message type
   * @param signalData Data to send
   * @param to An OpenTok connection object
   * https://tokbox.com/developer/guides/signaling/js/
   */
  async signal(type: string, signalData: any, to: OT.Connection): Promise<void> {
    const data = JSON.stringify(signalData);
    const signal = to ? { type, data, to } : { type, data };
    return await (new Promise((resolve, reject) => {
      this.session.signal(signal, (error) => {
        error ? reject(error) : resolve();
      });
    }));
  }

  /**
   * Disconnect from the OpenTok session
   */
  disconnect() {
    this.session.disconnect();
    this.reset();
  }

  /**
   * Return the state of the OpenTok session
   */
  state() {
    return this.all();
  }

  /**
   * Initialize an OpenTok publisher object
   * @param element The target element
   * @param properties The publisher properties
   */
  async initPublisher(element: string | HTMLElement, properties: OT.PublisherProperties): Promise<OT.Publisher> {
    return await (new Promise((resolve, reject) => {
      const publisher = OT.initPublisher(element, properties, (error) => {
        error ? reject(error) : resolve(publisher);
      });
    }));
  }
}

declare var global: any;
declare var window: any;

if (global === window) {
  window.OpenTokSDK = OpenTokSDK;
}

/**
 * Binds and sets a single event listener on the OpenTok session
 * @param event - The name of the event
 * @param callback
 */
const bindListener = (target, context, event, callback) => {
  const paramsError = '\'on\' requires a string and a function to create an event listener.';
  if (typeof event !== 'string' || typeof callback !== 'function') {
    throw new SDKError(paramsError, 'invalidParameters');
  }
  target.on(event, callback.bind(context));
};

/**
 * Bind and set event listeners
 * @param {Object} target - An OpenTok session, publisher, or subscriber object
 * @param {Object} context - The context to which to bind event listeners
 * @param {Object | Array} listeners - An object (or array of objects) with
 *        eventName/callback k/v pairs
 */
const bindListeners = (target, context, listeners) => {
  /**
   * Create listeners from an object with event/callback k/v pairs
   * @param {Object} listeners
   */
  const createListenersFromObject = (eventListeners) => {
    Object.keys(eventListeners).forEach((event) => {
      bindListener(target, context, event, eventListeners[event]);
    });
  };

  if (Array.isArray(listeners)) {
    listeners.forEach(listener => createListenersFromObject(listener));
  } else {
    createListenersFromObject(listeners);
  }
};