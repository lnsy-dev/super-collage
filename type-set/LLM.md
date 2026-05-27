# WARP.md

This is a vanilla js, css and html project. It uses webpack to build the files. 



Please use dataroom-js for all custom html elements, and use the above features in dataroom-js. https://github.com/DATAROOM-NETWORK/dataroom.js

Basic Usage
To use DataroomElement, you can either use it directly in your HTML or extend it to create your own custom components.

Extending DataroomElement
import DataroomElement from 'dataroom-js';

class MyComponent extends DataroomElement {
  async initialize() {
    // Your initialization logic here
  }
}

customElements.define('my-component', MyComponent);
Features
create(type, attributes, target_el)
Creates a new HTML element and appends it to the component or a specified target.

Example:

class MyComponent extends DataroomElement {
  async initialize() {
    const container = this.create('div', { class: 'container' });
    this.create('p', { content: 'Hello, World!' }, container);
  }
}
event(name, detail)
Emits a custom event from the component.

Example:

class MyComponent extends DataroomElement {
  async initialize() {
    this.event('my-event', { foo: 'bar' });
  }
}

const myComponent = document.querySelector('my-component');
myComponent.addEventListener('my-event', (e) => {
  console.log(e.detail); // { foo: 'bar' }
});
on(name, cb) and once(name, cb)
Attaches an event listener to the component. once is a variant that fires the listener only one time.

on Example:

class MyComponent extends DataroomElement {
  async initialize() {
    this.on('my-event', (detail) => {
      console.log('This will be logged every time:', detail);
    });

    this.event('my-event', { foo: 'bar' });
    this.event('my-event', { foo: 'baz' });
  }
}
once Example:

class MyComponent extends DataroomElement {
  async initialize() {
    this.once('one-time-event', (detail) => {
      console.log('This will only be logged once:', detail);
    });

    // Firing the event multiple times
    this.event('one-time-event', { attempt: 1 });
    this.event('one-time-event', { attempt: 2 });
  }
}
call(endpoint, body)
A helper for making fetch requests. It includes features for handling different security schemes and request timeouts.

security-scheme Attribute
Determines the authentication method:

localstorage: (Default) Sends a bearer token from localStorage.
cookie: Relies on the browser to send cookies automatically.
Example:

<my-component security-scheme="localstorage"></my-component>
// In your component
const data = await this.call('/api/data');
call-timeout Attribute
Sets a timeout for the request in milliseconds.

Example:

<my-component call-timeout="5000"></my-component>
getJSON(url)
Fetches a JSON file from a URL, parses it, and returns it as a JavaScript object. It includes robust error handling for network issues, bad HTTP statuses, and JSON parsing errors.

Example:

class JsonComponent extends DataroomElement {
  async initialize() {
    try {
      // Public APIs are great for examples
      const data = await this.getJSON('https://jsonplaceholder.typicode.com/users/1');
      this.log(`Fetched user: ${data.name}`);
      this.innerHTML = `Hello, ${data.name}!`;
    } catch (error) {
      console.error(error);
      this.innerHTML = `Failed to fetch data: ${error.message}`;
    }
  }
}
log(message)
Logs a message to the console if the verbose attribute is set.

Example:

<my-component verbose="true"></my-component>
class MyComponent extends DataroomElement {
  async initialize() {
    this.log('Initializing component...');
  }
}
Lifecycle Methods
DataroomElement provides several lifecycle methods that you can override to control the component's behavior.

initialize(): Called after the component is connected to the DOM and its attributes are available.
disconnect(): Called when the component is removed from the DOM.
Example:

class MyComponent extends DataroomElement {
  async initialize() {
    console.log('Component initialized!');
  }

  async disconnect() {
    console.log('Component disconnected!');
  }
}
Attribute Observation
DataroomElement automatically observes attribute changes and fires a NODE-CHANGED event.

Example:

class MyComponent extends DataroomElement {
  async initialize() {
    this.on('NODE-CHANGED', (detail) => {
      console.log(detail.attribute, detail.newValue);
    });
  }
}

const myComponent = document.querySelector('my-component');
myComponent.setAttribute('foo', 'bar'); // Logs: foo bar

We do not use shadowdom.

We do not embedd CSS in our Javascript -- we have separate CSS for that. If you think you need a CSS for a component, create a new CSS file in the styles/ folder with the name of the component and import it via the index.css file. 

We use DockBlock style comments for all code.